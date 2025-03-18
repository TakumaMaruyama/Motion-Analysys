import { createClient } from '@supabase/supabase-js';
import { Pose } from '@mediapipe/pose';
import { FFmpeg } from '@ffmpeg/ffmpeg';

const ffmpeg = new FFmpeg();

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
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  
  // Supabaseに元の動画をアップロード
  const timestamp = Date.now();
  const originalFileName = `original_${timestamp}.mp4`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('videos')
    .upload(originalFileName, videoBlob);

  if (uploadError) throw new Error('動画のアップロードに失敗しました');

  // MediaPipe Poseの初期化（全身検出に最適化）
  const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });

  pose.setOptions({
    modelComplexity: 2, // より高精度なモデルを使用
    smoothLandmarks: true,
    minDetectionConfidence: 0.7, // 検出の信頼度を上げる
    minTrackingConfidence: 0.7
  });

  // 動画からフレームを抽出してランドマークを検出
  const video = document.createElement('video');
  video.src = URL.createObjectURL(videoBlob);
  await video.load();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const landmarkData: LandmarkData[] = [];
  const processedFrames: ImageData[] = [];
  
  // 動画の処理を Promise でラップ
  await new Promise<void>((resolve) => {
    let frameCount = 0;
    const fps = 30;
    const duration = video.duration;
    const totalFrames = Math.floor(duration * fps);

    video.currentTime = 0;
    video.play();

    pose.onResults((results) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0);
      
      if (results.poseLandmarks) {
        // ランドマークデータを保存
        landmarkData.push({
          frame: frameCount,
          landmarks: results.poseLandmarks.map(l => ({
            x: l.x,
            y: l.y,
            z: l.z,
            visibility: l.visibility
          }))
        });

        // 骨格線を描画（高い可視性のみ）
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
          // 主要な関節のインデックスのみ描画
          const majorJoints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
          if (majorJoints.includes(index) && landmark.visibility && landmark.visibility > 0.7) {
            ctx.beginPath();
            ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 6, 0, 2 * Math.PI);
            ctx.fillStyle = '#FF0000';
            ctx.fill();
          }
        });
      }

      processedFrames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      frameCount++;

      if (frameCount >= totalFrames) {
        video.pause();
        resolve();
      } else {
        video.currentTime = frameCount / fps;
      }
    });

    // 最初のフレームを処理
    pose.send({image: video});
  });

  // FFmpegを使用して新しい動画を生成
  await ffmpeg.load();
  
  const frames = processedFrames.map((frame) => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    tempCanvas.getContext('2d')!.putImageData(frame, 0, 0);
    return tempCanvas.toDataURL('image/jpeg');
  });

  // フレームを結合して新しい動画を生成
  const processedFileName = `processed_${timestamp}.mp4`;
  await ffmpeg.writeFile('frames.txt', frames.join('\n'));
  await ffmpeg.exec([
    '-f', 'concat',
    '-i', 'frames.txt',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    processedFileName
  ]);

  const processedVideoData = await ffmpeg.readFile(processedFileName);
  const processedVideoBlob = new Blob([processedVideoData], { type: 'video/mp4' });

  // 処理済み動画をSupabaseにアップロード
  const { data: processedData, error: processedError } = await supabase.storage
    .from('videos')
    .upload(processedFileName, processedVideoBlob);

  if (processedError) throw new Error('処理済み動画のアップロードに失敗しました');

  // ランドマークデータをデータベースに保存
  const { error: dbError } = await supabase
    .from('landmarks')
    .insert({ video_id: timestamp, data: landmarkData });

  if (dbError) throw new Error('ランドマークデータの保存に失敗しました');

  return {
    originalUrl: supabase.storage.from('videos').getPublicUrl(originalFileName).data.publicUrl,
    processedUrl: supabase.storage.from('videos').getPublicUrl(processedFileName).data.publicUrl,
    landmarkData
  };
}