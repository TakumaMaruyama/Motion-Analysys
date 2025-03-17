import { createClient } from '@supabase/supabase-js';
import { Hands } from '@mediapipe/hands';
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';

const ffmpeg = createFFmpeg({ log: true });

interface LandmarkData {
  frame: number;
  landmarks: {
    x: number;
    y: number;
    z: number;
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

  // MediaPipe Handsの初期化
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
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

  hands.onResults((results) => {
    ctx.drawImage(video, 0, 0);
    
    if (results.multiHandLandmarks) {
      results.multiHandLandmarks.forEach(landmarks => {
        landmarkData.push({
          frame: video.currentTime * 30, // 30fpsと仮定
          landmarks: landmarks.map(l => ({ x: l.x, y: l.y, z: l.z }))
        });

        // ランドマークを描画
        landmarks.forEach((landmark, index) => {
          ctx.beginPath();
          ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 5, 0, 2 * Math.PI);
          ctx.fillStyle = '#FF0000';
          ctx.fill();
        });
      });
    }

    processedFrames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  });

  // FFmpegを使用して新しい動画を生成
  await ffmpeg.load();
  
  const frames = processedFrames.map((frame, index) => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    tempCanvas.getContext('2d')!.putImageData(frame, 0, 0);
    return tempCanvas.toDataURL('image/jpeg');
  });

  // フレームを結合して新しい動画を生成
  const processedFileName = `processed_${timestamp}.mp4`;
  ffmpeg.FS('writeFile', 'frames.txt', frames.join('\n'));
  await ffmpeg.run(
    '-f', 'concat',
    '-i', 'frames.txt',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    processedFileName
  );

  const processedVideoData = ffmpeg.FS('readFile', processedFileName);
  const processedVideoBlob = new Blob([processedVideoData.buffer], { type: 'video/mp4' });

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