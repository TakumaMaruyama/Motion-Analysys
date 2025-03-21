import { Holistic, Results, ResultsListener } from '@mediapipe/holistic';
import { LandmarkData, Landmark } from '../types/motion';

// メインスレッドから受け取るメッセージの型
interface WorkerMessage {
  type: 'init' | 'detect' | 'terminate';
  imageData?: ImageData;
  frameIndex?: number;
  timestamp?: number;
  config?: {
    modelComplexity: 1 | 0 | 2; // 明示的に許可された値のみ
    smoothLandmarks: boolean;
    minDetectionConfidence: number;
    minTrackingConfidence: number;
    refineFaceLandmarks: boolean;
  };
}

// メインスレッドに送り返すメッセージの型
interface WorkerResponse {
  type: 'initialized' | 'detected' | 'error';
  landmarks?: LandmarkData;
  frameIndex?: number;
  timestamp?: number;
  processingTime?: number;
  error?: {
    message: string;
    code: string;
  };
}

let holistic: Holistic | null = null;

// ランドマークの信頼度を計算
function calculateConfidence(results: Results): {
  pose: number;
  face: number;
  leftHand: number;
  rightHand: number;
} {
  const calcAvgVisibility = (landmarks: any[] = []): number => {
    if (!landmarks || landmarks.length === 0) return 0;
    const visibilitySum = landmarks.reduce((sum, lm) => 
      sum + (typeof lm.visibility === 'number' ? lm.visibility : 0), 0);
    return visibilitySum / landmarks.length;
  };
  
  return {
    pose: calcAvgVisibility(results.poseLandmarks || []),
    face: results.faceLandmarks ? 
      results.faceLandmarks.length > 0 ? 0.8 : 0 : 0, // 簡易的な顔検出信頼度
    leftHand: calcAvgVisibility(results.leftHandLandmarks || []),
    rightHand: calcAvgVisibility(results.rightHandLandmarks || [])
  };
}

// メディアパイプの結果をLandmark配列に変換
function convertToLandmarks(mediapipeLandmarks: any[] = []): Landmark[] {
  if (!mediapipeLandmarks) return [];
  
  return mediapipeLandmarks.map(lm => ({
    x: lm.x || 0,
    y: lm.y || 0,
    z: lm.z || 0,
    visibility: typeof lm.visibility === 'number' ? lm.visibility : undefined
  }));
}

// メインロジック
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, imageData, frameIndex, timestamp, config } = event.data;

  try {
    switch (type) {
      case 'init':
        if (holistic) {
          holistic.close();
        }
        
        holistic = new Holistic({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`;
          }
        });
        
        holistic.setOptions({
          modelComplexity: config?.modelComplexity ?? 1,
          smoothLandmarks: config?.smoothLandmarks ?? true,
          minDetectionConfidence: config?.minDetectionConfidence ?? 0.5,
          minTrackingConfidence: config?.minTrackingConfidence ?? 0.5,
          refineFaceLandmarks: config?.refineFaceLandmarks ?? true,
        });
        
        holistic.onResults(() => {
          // 結果は自動的に返さない - detectメッセージで明示的に処理
        });
        
        self.postMessage({
          type: 'initialized'
        } as WorkerResponse);
        break;
        
      case 'detect':
        if (!holistic || !imageData || frameIndex === undefined || timestamp === undefined) {
          throw new Error('Holistic not initialized or missing data');
        }
        
        // ImageDataをBitmapに変換
        const imageBitmap = await self.createImageBitmap(imageData);
        
        const startTime = performance.now();
        
        // 分析を実行
        const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(imageBitmap, 0, 0);
        
        // 直接画像からの処理にはcanvas.captureStream()が使えないため、
        // 代わりにHolisticのprocess関数を使用
        const results: Results = await new Promise((resolve) => {
          let resultData: Results;
          
          // 一時的にonResultsをオーバーライド
          const originalOnResults = holistic!.onResults;
          holistic!.onResults = (listener: ResultsListener) => {
            resultData = listener as unknown as Results;
            resolve(resultData);
          };
          
          // 画像を処理
          holistic!.send({image: canvas as unknown as HTMLCanvasElement});
          
          // 元のコールバックを復元
          holistic!.onResults = originalOnResults;
        });
        
        const processingTime = performance.now() - startTime;
        
        // 結果をフォーマット
        const landmarkData: LandmarkData = {
          pose: convertToLandmarks(results.poseLandmarks || []),
          faceMesh: convertToLandmarks(results.faceLandmarks || []),
          leftHand: convertToLandmarks(results.leftHandLandmarks || []),
          rightHand: convertToLandmarks(results.rightHandLandmarks || []),
          timestamp,
          frameIndex,
          confidence: calculateConfidence(results)
        };
        
        // 結果を返信
        self.postMessage({
          type: 'detected',
          landmarks: landmarkData,
          frameIndex,
          timestamp,
          processingTime,
        } as WorkerResponse);
        
        // クリーンアップ
        imageBitmap.close();
        break;
        
      case 'terminate':
        if (holistic) {
          holistic.close();
          holistic = null;
        }
        break;
    }
  } catch (err) {
    const error = err as Error;
    self.postMessage({
      type: 'error',
      frameIndex,
      timestamp,
      error: {
        message: error.message,
        code: 'DETECTION_ERROR'
      }
    } as WorkerResponse);
  }
}; 