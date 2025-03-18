import { createClient } from '@supabase/supabase-js';
import { Pose } from '@mediapipe/pose';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { FFmpeg } from '@ffmpeg/ffmpeg';

const ffmpeg = new FFmpeg();

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

  // MediaPipe Poseの初期化
  const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });

  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
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
  
  // 動画の処理を Promise でラップ
  await new Promise<void>((resolve) => {
    let frameCount = 0;
    const fps = 30;
    const duration = video.duration;
    const totalFrames = Math.floor(duration * fps);

    video.currentTime = 0;
    video.play();

    pose.onResults((results) => {
      ctx.drawImage(video, 0, 0);
      
      if (results.poseLandmarks) {
        landmarkData.push({
          frame: frameCount,
          landmarks: results.poseLandmarks.map(l => ({
            x: l.x,
            y: l.y,
            z: l.z,
            visibility: l.visibility
          }))
        });

        // ランドマークを描画
        results.poseLandmarks.forEach((landmark) => {
          if (landmark.visibility && landmark.visibility > 0.5) {
            ctx.beginPath();
            ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 5, 0, 2 * Math.PI);
            ctx.fillStyle = '#00FF00';
            ctx.fill();
          }
        });

        // 骨格線を描画
        drawConnectors(ctx, results.poseLandmarks, {
          color: '#00FF00',
          lineWidth: 2
        });
        drawLandmarks(ctx, results.poseLandmarks, {
          color: '#FF0000',
          lineWidth: 1,
          radius: 3
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