import { ProcessedFrame } from '../types/motion';

// メインスレッドから受け取るメッセージの型
interface WorkerMessage {
  type: 'init' | 'process' | 'interpolate' | 'encode' | 'terminate';
  frames?: ProcessedFrame[];
  targetFPS?: number;
  frameInterval?: number;
  quality?: number;
  width?: number;
  height?: number;
}

// メインスレッドに送り返すメッセージの型
interface WorkerResponse {
  type: 'initialized' | 'processed' | 'interpolated' | 'encoded' | 'progress' | 'error';
  frames?: ProcessedFrame[];
  progress?: number;
  stats?: {
    processingTime: number;
    framesProcessed: number;
    memoryUsage?: number;
  };
  error?: {
    message: string;
    code: string;
  };
}

// フレーム間を補間する関数
function interpolateFrames(frames: ProcessedFrame[], targetFPS: number): ProcessedFrame[] {
  if (frames.length < 2) return frames;
  
  const result: ProcessedFrame[] = [];
  const frameDuration = 1000 / targetFPS; // ミリ秒単位でのフレーム間隔
  
  // 時間でソート
  const sortedFrames = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  
  // 開始時間と終了時間
  const startTime = sortedFrames[0].timestamp;
  const endTime = sortedFrames[sortedFrames.length - 1].timestamp;
  
  // 補間されたフレームの数
  const totalFrames = Math.ceil((endTime - startTime) / frameDuration);
  
  // フレームごとに処理
  for (let i = 0; i < totalFrames; i++) {
    const targetTime = startTime + i * frameDuration;
    
    // 最も近い2つのフレームを見つける
    let prevFrameIndex = -1;
    for (let j = 0; j < sortedFrames.length - 1; j++) {
      if (sortedFrames[j].timestamp <= targetTime && sortedFrames[j + 1].timestamp > targetTime) {
        prevFrameIndex = j;
        break;
      }
    }
    
    // ターゲット時間が最後のフレームより後の場合
    if (prevFrameIndex === -1) {
      // 最後の2フレームを使用
      prevFrameIndex = sortedFrames.length - 2;
      if (prevFrameIndex < 0) prevFrameIndex = 0;
    }
    
    const prevFrame = sortedFrames[prevFrameIndex];
    const nextFrame = sortedFrames[Math.min(prevFrameIndex + 1, sortedFrames.length - 1)];
    
    // 前後のフレームが同じ場合（最後のフレームなど）
    if (prevFrame.timestamp === nextFrame.timestamp) {
      result.push({
        ...prevFrame,
        timestamp: targetTime,
        index: i,
        metadata: {
          ...prevFrame.metadata,
          quality: 1.0 // 補間なし
        }
      });
      continue;
    }
    
    // 補間率（0から1の間）
    const t = (targetTime - prevFrame.timestamp) / (nextFrame.timestamp - prevFrame.timestamp);
    
    // 画像データの補間（線形ブレンド）
    const interpolatedImageData = interpolateImageData(
      prevFrame.imageData, 
      nextFrame.imageData, 
      t
    );
    
    // メタデータ
    const quality = 1 - Math.abs(t - 0.5) * 0.5; // 両端に近いほど品質は高い
    
    // 補間されたフレームを追加
    result.push({
      imageData: interpolatedImageData,
      timestamp: targetTime,
      sourceTime: targetTime / 1000, // 秒単位に変換
      index: i,
      landmarks: prevFrame.landmarks, // ランドマークは補間せず近い方を使用
      metadata: {
        processingTime: prevFrame.metadata.processingTime,
        captureTime: prevFrame.metadata.captureTime,
        quality
      }
    });
  }
  
  return result;
}

// 2つの画像データ間を補間
function interpolateImageData(img1: ImageData, img2: ImageData, t: number): ImageData {
  // 画像サイズが異なる場合は最初の画像を使用
  if (img1.width !== img2.width || img1.height !== img2.height) {
    return new ImageData(
      new Uint8ClampedArray(img1.data),
      img1.width,
      img1.height
    );
  }
  
  const result = new Uint8ClampedArray(img1.data.length);
  
  // ピクセルごとに線形補間
  for (let i = 0; i < img1.data.length; i += 4) {
    // RGB各チャネルを補間
    result[i] = Math.round(img1.data[i] * (1 - t) + img2.data[i] * t);       // R
    result[i + 1] = Math.round(img1.data[i + 1] * (1 - t) + img2.data[i + 1] * t); // G
    result[i + 2] = Math.round(img1.data[i + 2] * (1 - t) + img2.data[i + 2] * t); // B
    result[i + 3] = Math.round(img1.data[i + 3] * (1 - t) + img2.data[i + 3] * t); // A
  }
  
  return new ImageData(result, img1.width, img1.height);
}

// メモリ使用量を概算（バイト単位）
function estimateMemoryUsage(frames: ProcessedFrame[]): number {
  if (frames.length === 0) return 0;
  
  // サンプルフレームのサイズを計算
  const sampleFrame = frames[0];
  const imageDataSize = sampleFrame.imageData.data.length;
  
  // ランドマークデータのサイズを概算
  const landmarkSize = sampleFrame.landmarks ? 
    JSON.stringify(sampleFrame.landmarks).length * 2 : 0;
  
  // メタデータのサイズを概算
  const metadataSize = JSON.stringify(sampleFrame.metadata).length * 2;
  
  // 1フレームあたりの合計サイズ
  const frameSizeBytes = imageDataSize + landmarkSize + metadataSize + 100; // 100バイトは余裕分
  
  return frameSizeBytes * frames.length;
}

// メインロジック
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, frames, targetFPS, frameInterval, quality, width, height } = event.data;
  
  try {
    switch (type) {
      case 'init':
        self.postMessage({
          type: 'initialized'
        } as WorkerResponse);
        break;
        
      case 'interpolate':
        if (!frames || frames.length < 2 || !targetFPS) {
          throw new Error('Interpolation requires at least 2 frames and target FPS');
        }
        
        const startTime = performance.now();
        
        // フレーム補間処理
        const interpolatedFrames = interpolateFrames(frames, targetFPS);
        
        const processingTime = performance.now() - startTime;
        const memoryUsage = estimateMemoryUsage(interpolatedFrames);
        
        self.postMessage({
          type: 'interpolated',
          frames: interpolatedFrames,
          stats: {
            processingTime,
            framesProcessed: interpolatedFrames.length,
            memoryUsage
          }
        } as WorkerResponse);
        break;
        
      case 'encode':
        // ここではエンコード処理は実装せず、メインスレッドで実行
        self.postMessage({
          type: 'error',
          error: {
            message: 'Encoding is not implemented in worker, use main thread instead',
            code: 'NOT_IMPLEMENTED'
          }
        } as WorkerResponse);
        break;
        
      case 'terminate':
        // 明示的な終了処理は不要
        break;
    }
  } catch (err) {
    const error = err as Error;
    self.postMessage({
      type: 'error',
      error: {
        message: error.message,
        code: 'PROCESSING_ERROR'
      }
    } as WorkerResponse);
  }
}; 