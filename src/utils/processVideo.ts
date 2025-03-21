import { createClient } from '@supabase/supabase-js';
import { Pose } from '@mediapipe/pose';
import { fetchFile } from '@ffmpeg/util';

// 全身の主要な骨格線の接続を定義
const POSE_CONNECTIONS = [
  // 上半身
  [11, 12], // 肩
  [11, 13], [13, 15], // 左腕
  [12, 14], [14, 16], // 右腕
  [11, 23], [12, 24], // 胴体
  // 下半身
  [23, 24], // 腰
  [23, 25], [25, 27], [27, 29], [29, 31], // 左脚
  [24, 26], [26, 28], [28, 30], [30, 32]  // 右脚
];

interface LandmarkData {
  frame: number;
  landmarks: {
    x: number;
    y: number;
    z: number;
    visibility?: number;
  }[];
}

export async function processVideo(videoBlob: Blob) {
  console.log('処理開始:', videoBlob.size, 'bytes');

  try {
    // 1. 動画の基本情報を取得
    const videoObjectUrl = URL.createObjectURL(videoBlob);
    const video = document.createElement('video');
    video.src = videoObjectUrl;
    
    // 動画のメタデータをロード
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = (e) => reject(new Error('動画メタデータの読み込みに失敗しました'));
      video.load();
    });
    
    console.log('動画サイズ:', video.videoWidth, 'x', video.videoHeight);
    console.log('動画長さ:', video.duration, '秒');

    // 2. キャンバスの準備
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // 3. MediaPipe Poseの初期化
    console.log('Poseモデルを初期化中...');
    const pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
    });

    await new Promise<void>((resolve) => {
      pose.onResults(() => resolve()); // モデルの初期化を確認
    });

    pose.setOptions({
      modelComplexity: 1, // 処理速度とのバランスを取る
      smoothLandmarks: true,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    console.log('フレーム処理を開始...');
    
    // 4. フレーム処理
    const landmarkData: LandmarkData[] = [];
    const frames: string[] = []; // データURLとして保存
    
    // フレーム処理関数
    const processFrame = async (currentTime: number): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        video.currentTime = currentTime;
        
        video.onseeked = async () => {
          // 現在のフレームを描画
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(video, 0, 0);
          
          // ポーズ検出
          await pose.send({image: canvas});
          
          // フレームを保存
          frames.push(canvas.toDataURL('image/jpeg', 0.9));
          resolve(true);
        };
      });
    };

    // ポーズ検出結果のハンドラ
    pose.onResults((results) => {
      if (!results.poseLandmarks) return;
      
      // ランドマークデータを保存
      const frameIndex = frames.length - 1;
      landmarkData.push({
        frame: frameIndex,
        landmarks: results.poseLandmarks.map(l => ({
          x: l.x,
          y: l.y,
          z: l.z,
          visibility: l.visibility
        }))
      });
      
      // 動画フレームを描画
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0);
      
      // 骨格線を描画
      for (const [start, end] of POSE_CONNECTIONS) {
        const startLandmark = results.poseLandmarks[start];
        const endLandmark = results.poseLandmarks[end];
        
        if (startLandmark?.visibility && endLandmark?.visibility &&
            startLandmark.visibility > 0.7 && endLandmark.visibility > 0.7) {
          ctx.beginPath();
          ctx.moveTo(startLandmark.x * canvas.width, startLandmark.y * canvas.height);
          ctx.lineTo(endLandmark.x * canvas.width, endLandmark.y * canvas.height);
          ctx.strokeStyle = '#00FF00';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
      
      // 主要な関節ポイントを描画
      results.poseLandmarks.forEach((landmark, index) => {
        const majorJoints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
        if (majorJoints.includes(index) && landmark.visibility && landmark.visibility > 0.7) {
          ctx.beginPath();
          ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 6, 0, 2 * Math.PI);
          ctx.fillStyle = '#FF0000';
          ctx.fill();
        }
      });
      
      // 現在のキャンバスを保存（上書き）
      frames[frameIndex] = canvas.toDataURL('image/jpeg', 0.9);
    });

    // フレームを等間隔で処理
    const fps = 5; // パフォーマンスを考慮して低いフレームレートに設定
    const duration = video.duration;
    const frameCount = Math.min(30, Math.floor(duration * fps)); // 最大30フレームに制限
    const timeStep = duration / frameCount;
    
    console.log(`処理フレーム数: ${frameCount}, 間隔: ${timeStep}秒`);
    
    for (let i = 0; i < frameCount; i++) {
      await processFrame(i * timeStep);
      console.log(`フレーム ${i+1}/${frameCount} 処理完了`);
    }

    // 5. 処理済み動画の作成 (クライアントサイドのみ)
    console.log('処理済みフレーム数:', frames.length);
    
    // 処理済みのフレームから動画をキャプチャ
    const processedVideo = document.createElement('video');
    const captureCanvas = document.createElement('canvas');
    const captureCtx = captureCanvas.getContext('2d')!;
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    
    // キャプチャ開始前にフレームを読み込む
    const loadFrameImage = (dataUrl: string): Promise<HTMLImageElement> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = dataUrl;
      });
    };
    
    // MediaRecorderでキャプチャ
    const chunks: Blob[] = [];
    const mediaRecorder = new MediaRecorder(captureCanvas.captureStream(fps), {
      mimeType: 'video/mp4;codecs=h264',
    });
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };
    
    let processedVideoUrl: string;
    
    await new Promise<void>(async (resolve) => {
      mediaRecorder.onstop = () => {
        const processedBlob = new Blob(chunks, { type: 'video/mp4' });
        processedVideoUrl = URL.createObjectURL(processedBlob);
        resolve();
      };
      
      mediaRecorder.start();
      
      // フレームを順番に表示
      for (const frameDataUrl of frames) {
        const img = await loadFrameImage(frameDataUrl);
        captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
        captureCtx.drawImage(img, 0, 0, captureCanvas.width, captureCanvas.height);
        await new Promise(r => setTimeout(r, 1000 / fps));
      }
      
      mediaRecorder.stop();
    });
    
    console.log('動画処理完了');
    
    // リソースを解放
    URL.revokeObjectURL(videoObjectUrl);
    
    return {
      processedUrl: processedVideoUrl!,
      landmarkData
    };
    
  } catch (error) {
    console.error('動画処理エラー:', error);
    throw error;
  }
}