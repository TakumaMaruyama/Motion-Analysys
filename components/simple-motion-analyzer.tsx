'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Download, Upload, Video, Play, Pause, Film, Camera as CameraIcon, Settings, Info, RefreshCcw } from 'lucide-react';
import { Holistic, POSE_CONNECTIONS, HAND_CONNECTIONS, FACEMESH_TESSELATION, Results } from '@mediapipe/holistic';
import { Camera } from '@mediapipe/camera_utils';
import { drawLandmarks, drawConnectors } from '@mediapipe/drawing_utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { VideoEncoderService } from '@/lib/video-encoder';
import type { ProcessedFrame } from '@/types/motion';

type AnalysisMode = 'camera' | 'video';

// 動画処理の状態を定義
type VideoProcessingStatus = 'idle' | 'loading' | 'processing' | 'completed' | 'error';

// 動画処理の進捗情報の型
interface ProcessingProgress {
  status: VideoProcessingStatus;
  progress: number;
  currentFrame: number;
  totalFrames: number;
  fps: number;
  elapsedTime: number;
  estimatedTimeRemaining: number;
  error?: string;
}

const SimpleMotionAnalyzer: React.FC = () => {
  // 分析モード設定
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('camera');

  // カメラ関連の状態
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [outputVideoUrl, setOutputVideoUrl] = useState<string | null>(null);
  const [recordedMimeType, setRecordedMimeType] = useState<string | null>(null);
  const [originalFrameRate, setOriginalFrameRate] = useState<number>(30);
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null);
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [isVideoAnalyzing, setIsVideoAnalyzing] = useState<boolean>(false);
  const [isVideoReady, setIsVideoReady] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user'); // スマホはインカメをデフォルト

  // 統計情報
  const [stats, setStats] = useState({
    framesProcessed: 0,
    fps: 0,
    elapsedTime: 0,
    progress: 0,
    estimatedTimeRemaining: 0
  });

  // refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadedVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holisticRef = useRef<Holistic | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const frameCountRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const lastProcessTsRef = useRef<number>(0);
  const desiredProcessingFpsRef = useRef<number>(24);
  const animationFrameRef = useRef<number | null>(null);
  const videoAnalysisStartTimeRef = useRef<number>(0);
  const videoAnalysisFrameCountRef = useRef<number>(0);
  const shouldAutoDownloadRef = useRef<boolean>(false);
  const latestResultsRef = useRef<Results | null>(null);
  const capturedFramesRef = useRef<ProcessedFrame[]>([]);
  const isHqExportingRef = useRef<boolean>(false);

  // 状態管理を拡張
  const [processingStatus, setProcessingStatus] = useState<VideoProcessingStatus>('idle');
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress>({
    status: 'idle',
    progress: 0,
    currentFrame: 0,
    totalFrames: 0,
    fps: 0,
    elapsedTime: 0,
    estimatedTimeRemaining: 0
  });

  // 動画処理の進捗更新（他のコールバックから参照されるため早めに定義）
  const updateProcessingProgress = useCallback((updates: Partial<ProcessingProgress>) => {
    setProcessingProgress(prev => ({
      ...prev,
      ...updates
    }));
  }, []);

  // フレーム処理用のワーカー状態
  const frameProcessorRef = useRef<{
    isProcessing: boolean;
    shouldStop: boolean;
    currentTime: number;
    processedFrames: number;
    startTime: number;
    lastUpdateTime: number;
  }>({
    isProcessing: false,
    shouldStop: false,
    currentTime: 0,
    processedFrames: 0,
    startTime: 0,
    lastUpdateTime: 0
  });

  // グローバル変数の代わりにuseRefを使用するように修正
  const analysisTimerIdRef = useRef<NodeJS.Timeout>();
  const videoProcessingIntervalIdRef = useRef<NodeJS.Timeout>();
  
  // なめらかな描画用レンダーループ
  const drawOverlay = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const results = latestResultsRef.current;
    if (!results) return;
    
    // 顔のメッシュを描画
    if (results.faceLandmarks) {
      drawConnectors(ctx, results.faceLandmarks, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });
    }
    // 姿勢
    if (results.poseLandmarks) {
      drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
      drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 1 });
    }
    // 手
    if (results.leftHandLandmarks) {
      drawConnectors(ctx, results.leftHandLandmarks, HAND_CONNECTIONS, { color: '#CC0000', lineWidth: 2 });
      drawLandmarks(ctx, results.leftHandLandmarks, { color: '#00FF00', lineWidth: 1 });
    }
    if (results.rightHandLandmarks) {
      drawConnectors(ctx, results.rightHandLandmarks, HAND_CONNECTIONS, { color: '#00CC00', lineWidth: 2 });
      drawLandmarks(ctx, results.rightHandLandmarks, { color: '#FF0000', lineWidth: 1 });
    }
  }, []);

  const renderLoop = useCallback(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    // 背景を最新フレームで更新
    if (analysisMode === 'camera' && videoRef.current) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    } else if (analysisMode === 'video' && uploadedVideoRef.current) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(uploadedVideoRef.current, 0, 0, canvas.width, canvas.height);
    }
    // 最新結果をオーバーレイ
    drawOverlay(ctx, canvas.width, canvas.height);
    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, [analysisMode, drawOverlay]);

  const startRenderLoop = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, [renderLoop]);

  const stopRenderLoop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Holisticの初期化
  const initHolistic = useCallback(async () => {
    try {
      console.log('Holistic初期化開始');
      
      // すでに存在する場合はクリーンアップ
      if (holisticRef.current) {
        try {
          holisticRef.current.close();
        } catch (e) {
          console.error("既存のHolistic終了エラー:", e);
        }
        holisticRef.current = null;
      }
      
      const holistic = new Holistic({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`;
        }
      });

      holistic.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        refineFaceLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      holistic.onResults((results) => {
        // 結果を最新値として保持（描画は別のレンダーループで実行）
        latestResultsRef.current = results;
        const now = performance.now();
        if (analysisMode === 'camera') {
          frameCountRef.current++;
          if (startTimeRef.current === 0) {
            startTimeRef.current = now;
            lastFrameTimeRef.current = now;
          }
          const elapsedTime = now - startTimeRef.current;
          const frameDelta = now - lastFrameTimeRef.current;
          const currentFps = frameDelta > 0 ? 1000 / frameDelta : 0;
          lastFrameTimeRef.current = now;
          setStats({
            framesProcessed: frameCountRef.current,
            fps: Math.round(currentFps),
            elapsedTime: Math.round(elapsedTime / 1000),
            progress: 0,
            estimatedTimeRemaining: 0
          });
        } else if (analysisMode === 'video') {
          videoAnalysisFrameCountRef.current++;
          if (videoAnalysisStartTimeRef.current === 0) {
            videoAnalysisStartTimeRef.current = now;
            lastFrameTimeRef.current = now;
          }
          const elapsedTime = now - videoAnalysisStartTimeRef.current;
          const frameDelta = now - lastFrameTimeRef.current;
          const currentFps = frameDelta > 0 ? 1000 / frameDelta : 0;
          lastFrameTimeRef.current = now;
          setStats({
            framesProcessed: videoAnalysisFrameCountRef.current,
            fps: Math.round(currentFps),
            elapsedTime: Math.round(elapsedTime / 1000),
            progress: 0,
            estimatedTimeRemaining: 0
          });
        }
      });
      
      holisticRef.current = holistic;
      console.log('Holistic設定完了、初期化開始');
      // MediaPipe Holistic は初回 send 呼び出し時に内部的に読み込みが走るため
      // 明示的な initialize を待たずに初期化完了扱いにする
      console.log('Holistic初期化完了(暗黙ロード)');
      setIsInitialized(true);
      return true;
    } catch (error) {
      console.error('Holistic初期化エラー:', error);
      setIsInitialized(false);
      return false;
    }
  }, [analysisMode]);

  // カメラの初期化
  const initCamera = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('カメラ初期化開始');
      
      // 既存のリソースをクリーンアップ
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
      }
      
      // ユーザーのカメラにアクセス
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: cameraFacing
        },
        audio: false
      };
      
      console.log('カメラアクセス要求');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        console.warn('指定したカメラ取得に失敗。フォールバックします:', e);
        const fallback = cameraFacing === 'user' ? 'environment' : 'user';
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: fallback }, audio: false });
        setCameraFacing(fallback);
      }
      setVideoStream(stream);

      // 安定した解像度/フレームレートへ調整（利用可能な場合）
      try {
        const track = stream.getVideoTracks()[0];
        await track.applyConstraints({
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 30, max: 30 },
        } as MediaTrackConstraints);
      } catch {}
      
      // フレームレートを取得
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      const actualFrameRate = settings.frameRate || 30;
      setOriginalFrameRate(actualFrameRate);
      console.log('取得したフレームレート:', actualFrameRate);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // iOS Safari など自動再生のために必要
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        (videoRef.current as any).setAttribute?.('playsinline', 'true');
        (videoRef.current as any).setAttribute?.('autoplay', 'true');
        console.log('ビデオに接続、再生開始');
        try {
          await videoRef.current.play();
        } catch (playErr) {
          console.warn('video.play() 失敗。ユーザー操作が必要な可能性:', playErr);
        }
        
        // キャンバスのサイズを設定
        if (canvasRef.current) {
          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
          console.log('キャンバスサイズ設定:', canvasRef.current.width, 'x', canvasRef.current.height);
        }
        
        // まずHolisticを初期化
        console.log('カメラ接続後、Holisticを初期化');
        const success = await initHolistic();
        
        if (!success) {
          throw new Error("Holistic初期化に失敗");
        }
        
        // Holisticの準備ができてから、カメラを接続
        if (holisticRef.current) {
          console.log('Camera-Holistic接続を設定');
          cameraRef.current = new Camera(videoRef.current, {
            onFrame: async () => {
              if (holisticRef.current && videoRef.current) {
                const now = performance.now();
                const minInterval = 1000 / desiredProcessingFpsRef.current;
                if (now - lastProcessTsRef.current >= minInterval) {
                  lastProcessTsRef.current = now;
                  try {
                    await holisticRef.current.send({ image: videoRef.current });
                  } catch (e) {
                    // フレーム落ち時は無視
                  }
                }
              }
            },
            width: videoRef.current.videoWidth,
            height: videoRef.current.videoHeight,
            facingMode: cameraFacing
          });
          
          console.log('カメラ開始');
          await cameraRef.current.start();
          console.log('カメラ開始完了');
          // レンダーループ開始（結果反映をなめらかに）
          startRenderLoop();
        }
      }
      
      setIsLoading(false);
    } catch (error) {
      console.error('カメラの初期化に失敗しました:', error);
      setIsLoading(false);
      
      // エラー時に既存のリソースをクリーンアップ
      if (holisticRef.current) {
        holisticRef.current.close();
        holisticRef.current = null;
      }
      
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      
      setIsInitialized(false);
    }
  }, [initHolistic, videoStream, cameraFacing]);

  // カメラ切替
  const switchCamera = useCallback(async () => {
    const next = cameraFacing === 'user' ? 'environment' : 'user';
    // 既存のストリーム/カメラを停止
    try { cameraRef.current?.stop(); } catch {}
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
    }
    setVideoStream(null);
    setCameraFacing(next);
    // 再初期化
    await initHolistic();
    await initCamera();
  }, [cameraFacing, videoStream, initCamera, initHolistic]);

  // 録画した動画をダウンロード
  const downloadVideo = useCallback(() => {
    console.log('[downloadVideo] 開始');
    console.log('[downloadVideo] 状態確認:', { 
      outputVideoUrl: outputVideoUrl ? 'あり' : 'なし', 
      recordedChunks: recordedChunks.length,
      recordedMimeType
    });
    
    if (!outputVideoUrl) {
      console.error('[downloadVideo] ダウンロードするURLがありません');
      
      // データはあるがURLが未設定の場合の回復処理
      if (recordedChunks.length > 0) {
        console.log(`[downloadVideo] outputVideoUrlがないが、recordedChunks(${recordedChunks.length}個)からBlobを作成`);
        try {
          // 適切なMIMEタイプを推測
          let mimeType = 'video/webm';
          if (recordedMimeType) {
            mimeType = recordedMimeType;
          } else if (recordedChunks[0]?.type) {
            mimeType = recordedChunks[0].type;
          }
          
          console.log(`[downloadVideo] 推測されたMIMEタイプ: ${mimeType}`);
          const blob = new Blob(recordedChunks, { type: mimeType });
          console.log(`[downloadVideo] 回復Blob作成完了: size=${blob.size}, type=${blob.type}`);
          
          if (blob.size > 0) {
            const tempUrl = URL.createObjectURL(blob);
            console.log('[downloadVideo] 一時URL作成:', tempUrl);
            
            // outputVideoUrlを設定（将来の使用のため）
            setOutputVideoUrl(tempUrl);
            setRecordedMimeType(mimeType);
            
            // 一時URLを使用してダウンロード
            const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
            const a = document.createElement('a');
            a.href = tempUrl;
            a.download = `motion-analysis-${new Date().toISOString().replace(/:/g, '-')}.${extension}`;
            a.style.display = 'none';
            document.body.appendChild(a);
            
            console.log('[downloadVideo] ダウンロードリンクをクリック');
            a.click();
            
            // クリーンアップ
            setTimeout(() => {
              document.body.removeChild(a);
              // URL.revokeObjectURL(tempUrl); // 再利用できるように保持
              console.log('[downloadVideo] リンク要素を削除');
            }, 100);
            
            console.log('[downloadVideo] 回復処理でダウンロード完了');
            return;
          } else {
            console.error('[downloadVideo] 回復Blobのサイズが0です');
            alert('エラー: 録画データが破損しています。録画をやり直してください。');
          }
        } catch (e) {
          console.error('[downloadVideo] 回復処理中にエラー:', e);
          alert('エラー: 録画データの回復中に問題が発生しました。');
        }
      } else {
        console.error('[downloadVideo] 録画データがありません');
        // 録画が正しく開始されるようにする
        if (canvasRef.current && !isRecording && analysisMode === 'video') {
          console.log('[downloadVideo] 録画データがないためユーザーに録画を促します');
          alert('録画データがありません。まず「録画開始」ボタンをクリックして、動画を録画してください。');
          return;
        } else {
          alert('エラー: ダウンロードする録画データがありません。録画を先に行ってください。');
        }
      }
      return;
    }
    
    console.log('[downloadVideo] 通常のダウンロード処理開始 URL:', outputVideoUrl);
    
    // MIMEタイプから拡張子を決定
    let extension = 'webm'; // デフォルト
    let determinedMimeType = recordedMimeType; // ステートから取得
    
    console.log(`[downloadVideo] MIMEタイプ: ${determinedMimeType}, 録画チャンク数: ${recordedChunks.length}`);

    // recordedMimeType がなければ recordedChunks から推測
    if (!determinedMimeType && recordedChunks.length > 0 && recordedChunks[0]?.type) {
         determinedMimeType = recordedChunks[0].type;
      console.log(`[downloadVideo] recordedMimeType がないため、Blobタイプ ${determinedMimeType} から推測`);
    }

    if (determinedMimeType) {
        if (determinedMimeType.includes('mp4')) {
            extension = 'mp4';
        } else if (determinedMimeType.includes('webm')) {
            extension = 'webm';
        }
      console.log(`[downloadVideo] MIMEタイプ ${determinedMimeType} から拡張子 ${extension} を特定`);
    } else {
      console.warn('[downloadVideo] MIMEタイプを特定できませんでした。デフォルトの拡張子 .webm を使用します。');
    }

    try {
      // ダウンロードリンクを作成して自動クリック
    const a = document.createElement('a');
    a.href = outputVideoUrl;
    a.download = `motion-analysis-${new Date().toISOString().replace(/:/g, '-')}.${extension}`;
      a.style.display = 'none'; // 非表示
    document.body.appendChild(a);
      
      console.log('[downloadVideo] ダウンロードリンクをクリック');
    a.click();
      
      // クリーンアップ
      setTimeout(() => {
    document.body.removeChild(a);
        console.log('[downloadVideo] リンク要素を削除');
        // URL.revokeObjectURL(outputVideoUrl); // ここでは破棄しない（再ダウンロード用）
      }, 100);
      
      console.log('[downloadVideo] ダウンロード処理完了');
    } catch (e) {
      console.error('[downloadVideo] ダウンロード処理中にエラー:', e);
      alert('動画のダウンロード中にエラーが発生しました。ブラウザの設定を確認してください。');
    }
  }, [outputVideoUrl, recordedMimeType, recordedChunks, canvasRef, isRecording, analysisMode]);

  // 録画停止
  const stopRecording = useCallback(() => {
    console.log('[stopRecording] 開始');
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      console.log('[stopRecording] MediaRecorder停止処理を実行');
      
      try {
          console.log('[stopRecording] mediaRecorder.stop() 呼び出し');
          mediaRecorderRef.current.stop();
          console.log('[stopRecording] mediaRecorder.stop() 呼び出し完了');
      } catch (e) {
          console.error('[stopRecording] mediaRecorder.stop() でエラー:', e);
          // エラーが発生した場合でも、状態のリセットを試みる
          setIsRecording(false);
          mediaRecorderRef.current = null;
      }
    } else {
      console.log(`[stopRecording] 停止するMediaRecorderがないか、状態が非アクティブです。 State: ${mediaRecorderRef.current?.state}`);
      // 既に停止している場合や参照がない場合は、念のため状態をリセット
      if (isRecording) {
          console.log('[stopRecording] isRecording が true だったので false にリセット');
          setIsRecording(false);
      }
    }
    // HQキャプチャ停止
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    console.log('[stopRecording] 終了');
  }, [isRecording]);

  // 停止後にURLが未生成でも recordedChunks から生成してボタンを出す
  useEffect(() => {
    if (!isRecording && recordedChunks.length > 0 && !outputVideoUrl) {
      try {
        const mime = recordedMimeType || recordedChunks[0].type || 'video/webm';
        const blob = new Blob(recordedChunks, { type: mime });
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          setOutputVideoUrl(url);
        }
      } catch {}
    }
  }, [isRecording, recordedChunks, outputVideoUrl, recordedMimeType]);

  // フレーム補間して60fpsでエクスポート
  const exportHighQuality60fps = useCallback(async () => {
    if (isHqExportingRef.current) return;
    try {
      const frames = capturedFramesRef.current;
      if (!frames || frames.length < 2) {
        alert('高画質出力のためのフレームが不足しています。先に録画してください。');
        return;
      }
      isHqExportingRef.current = true;
      setProcessingStatus('processing');
      updateProcessingProgress({ status: 'processing', progress: 5 });

      // ワーカーで補間
      const worker = new Worker(new URL('../workers/frame-processor.worker.ts', import.meta.url), { type: 'module' });
      const interpolated: ProcessedFrame[] = await new Promise((resolve, reject) => {
        worker.onmessage = (e: MessageEvent) => {
          const data = e.data as any;
          if (data.type === 'interpolated') {
            resolve(data.frames);
            worker.terminate();
          } else if (data.type === 'error') {
            reject(new Error(data.error?.message || 'Worker error'));
            worker.terminate();
          }
        };
        worker.postMessage({ type: 'interpolate', frames, targetFPS: 60 });
      });

      updateProcessingProgress({ status: 'processing', progress: 50 });

      // エンコード（WebCodecs）
      const w = frames[0].imageData.width;
      const h = frames[0].imageData.height;
      const blob = await VideoEncoderService.encodeFramesToVideo(interpolated, {
        width: w,
        height: h,
        frameRate: 60,
        bitrate: 8_000_000,
        codec: 'avc1.42001E',
        latencyMode: 'quality',
        hardwareAcceleration: 'prefer-hardware'
      }, (p) => {
        updateProcessingProgress({ status: 'processing', progress: 50 + Math.round(p * 45) });
      });

      const url = URL.createObjectURL(blob);
      setOutputVideoUrl(url);
      setProcessingStatus('completed');
      updateProcessingProgress({ status: 'completed', progress: 100 });
    } catch (e) {
      console.error('高画質エクスポートエラー:', e);
      alert('高画質エクスポートに失敗しました。最新のChrome系ブラウザでお試しください。');
      setProcessingStatus('error');
      updateProcessingProgress({ status: 'error', error: 'HQ export failed' });
    } finally {
      isHqExportingRef.current = false;
    }
  }, [updateProcessingProgress]);

  // 録画開始
  const startRecording = useCallback(() => {
    console.log('[startRecording] 録画開始 - エントリーポイント');
    try {
    if (!canvasRef.current) {
      console.error('[startRecording] キャンバスが見つかりません');
        alert('エラー: 録画するキャンバスが見つかりません');
      return;
    }
    
    if (isRecording) {
        console.log('[startRecording] すでに録画中です');
      return;
    }
    
      // 既存データをクリア
    setRecordedChunks([]);
      setOutputVideoUrl('');
      const chunks: Blob[] = [];

      console.log('[startRecording] キャンバスからストリームを取得します');
      const captureFps = Math.min(Math.max(15, Math.round(originalFrameRate || 30)), 30);
      const stream = canvasRef.current.captureStream(captureFps); // 安定したFPSでキャプチャ
      
      // サポートされているMIMEタイプを確認
      const supportedTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
      ];
      
      let mimeType = '';
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          console.log(`[startRecording] サポートされているMIMEタイプ: ${mimeType}`);
          break;
        }
      }

      if (!mimeType) {
        console.error('[startRecording] サポートされているMIMEタイプが見つかりません');
        alert('エラー: お使いのブラウザでは録画がサポートされていません');
          return;
      }
      
      // MediaRecorderの設定
      const options = {
        mimeType,
        videoBitsPerSecond: 5000000 // 5Mbps に増加してブロックノイズを軽減
      };

      console.log('[startRecording] MediaRecorderを初期化します', options);
      const mediaRecorder = new MediaRecorder(stream, options);
      
      // データが利用可能になったときのイベントハンドラ
      mediaRecorder.ondataavailable = (event) => {
        console.log(`[ondataavailable] データチャンク取得: サイズ=${event.data.size} bytes, タイプ=${event.data.type}`);
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
          console.log(`[ondataavailable] ローカルchunks配列に追加: 現在${chunks.length}個`);
          
          // React状態を更新
          setRecordedChunks(prevChunks => {
            const newChunks = [...prevChunks, event.data];
            console.log(`[ondataavailable] React状態のrecordedChunksを更新: ${prevChunks.length}→${newChunks.length}個`);
            return newChunks;
            });
        } else {
          console.warn(`[ondataavailable] サイズが0のデータを受信しました`);
        }
      };
      
      // 録画が停止したときのイベントハンドラ
      mediaRecorder.onstop = () => {
        console.log(`[onstop] 録画停止 - ローカルchunks: ${chunks.length}個, recordedChunks: ${recordedChunks.length}個`);
        
        // デバッグ用に実際のチャンクをログ出力
        chunks.forEach((chunk, index) => {
          console.log(`[onstop] チャンク #${index}: サイズ=${chunk.size} bytes, タイプ=${chunk.type}`);
        });
        
        if (chunks.length === 0) {
          console.error('[onstop] ローカルchunksが空です');
          
          // recordedChunksを確認
          if (recordedChunks.length > 0) {
            console.log(`[onstop] recordedChunksには${recordedChunks.length}個のチャンクがあります。これを使用します。`);
            // recordedChunksを使用してBlobを作成
            const blob = new Blob(recordedChunks, { type: mimeType });
            console.log(`[onstop] recordedChunksからBlobを作成: サイズ=${blob.size} bytes`);
            const videoUrl = URL.createObjectURL(blob);
            setOutputVideoUrl(videoUrl);
              setRecordedMimeType(mimeType);
            } else {
            console.error('[onstop] recordedChunksも空です。録画データがありません。');
            alert('録画データが取得できませんでした。ブラウザの設定を確認してください。');
          }
             setIsRecording(false);
          return;
        }
        
        // Blobを作成してURLを生成
        const blob = new Blob(chunks, { type: mimeType });
        console.log(`[onstop] Blobを作成: サイズ=${blob.size} bytes, タイプ=${blob.type}`);
        
        if (blob.size === 0) {
          console.error('[onstop] 作成されたBlobのサイズが0です');
         setIsRecording(false); 
          alert('録画データが空です。ブラウザの互換性の問題かもしれません。');
          return;
        }
        
        const videoUrl = URL.createObjectURL(blob);
        console.log(`[onstop] URL生成: ${videoUrl}`);
        
        // React状態を更新
        setOutputVideoUrl(videoUrl);
        setRecordedMimeType(mimeType);
        setRecordedChunks(chunks); // ローカルchunksで最終的に更新
        setIsRecording(false);
        
        console.log('[onstop] 録画完了 - 状態更新完了');
      };

      // MediaRecorderを開始
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); // 100msごとにデータチャンクを取得（頻度を上げる）
      setIsRecording(true);
      console.log('[startRecording] 録画を開始しました (チャンク間隔: 100ms)');
      
      // HQエクスポート用のフレーム収集を開始
      if (canvasRef.current) {
        capturedFramesRef.current = [];
        const ctx = canvasRef.current.getContext('2d');
        const w = canvasRef.current.width;
        const h = canvasRef.current.height;
        if (ctx && w && h) {
          const intervalMs = Math.max(10, Math.round(1000 / captureFps));
          captureIntervalRef.current = setInterval(() => {
            try {
              const imageData = ctx.getImageData(0, 0, w, h);
              const ts = performance.now();
              capturedFramesRef.current.push({
                imageData,
                timestamp: ts,
                sourceTime: ts / 1000,
                index: capturedFramesRef.current.length,
                metadata: { processingTime: 0, captureTime: ts, quality: 1 }
              });
            } catch {}
          }, intervalMs);
        }
      }
      
      // 自動停止は行わない（ユーザー操作で停止）

    } catch (error) {
      console.error('[startRecording] エラー:', error);
      setIsRecording(false);
      alert(`録画中にエラーが発生しました: ${error}`);
    }
  }, [canvasRef, isRecording, recordedChunks]);

  // 動画分析の開始処理
  const startVideoAnalysis = useCallback(() => {
    if (!uploadedVideoRef.current || !canvasRef.current) {
      console.error('ビデオまたはキャンバスが見つかりません');
      return;
    }
    
    if (!isVideoReady) {
      console.error('ビデオの準備ができていません');
      return;
    }
    
    if (isVideoAnalyzing) {
      console.log('すでに分析中です');
      return;
    }
    
    console.log('動画分析を開始します - シンプル実装');
    
    // 動画要素を準備
    const videoElement = uploadedVideoRef.current;
    
    // 既存のタイマーをクリア
    if (videoProcessingIntervalIdRef.current) {
      clearInterval(videoProcessingIntervalIdRef.current);
      videoProcessingIntervalIdRef.current = undefined;
    }
    
    // キャンバス設定
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('キャンバスコンテキストを取得できません');
      return;
    }
    
    // 分析状態を初期化
    setIsVideoAnalyzing(true);
    videoAnalysisFrameCountRef.current = 0;
    videoAnalysisStartTimeRef.current = performance.now();
    
    // 動画の時間は0から開始
    videoElement.currentTime = 0;
    
    // 動画の総時間とサイズを取得
    const videoDuration = videoElement.duration;
    
    console.log(`動画情報:`, {
      時間: `${videoDuration.toFixed(2)}秒`,
      サイズ: `${videoElement.videoWidth}x${videoElement.videoHeight}`
    });
    
    // サイズを設定
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    // フレーム処理間隔（ミリ秒）
    const frameProcessingInterval = 40; // 約25fpsに相当
    let isProcessingFrame = false;
    let lastUpdateTime = 0;
    let processedFrameCount = 0;
    
    // このフラグで処理を停止できるようにする
    let shouldContinueProcessing = true;
    
    // フレーム処理ループ内の進捗更新部分を修正
    const processFrame = async () => {
      if (!shouldContinueProcessing || !isVideoAnalyzing) {
        console.log('処理中断');
        return;
      }
      
      if (isProcessingFrame) {
        console.log('前のフレームをまだ処理中です');
        setTimeout(processFrame, frameProcessingInterval);
        return;
      }
      
      isProcessingFrame = true;
      const videoElement = uploadedVideoRef.current;
      
      if (!videoElement) {
        console.error('ビデオ要素が見つかりません');
        return;
      }
      
      try {
        // 現在のフレームをキャンバスに描画
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        
        // MediaPipeモデルに送信
        if (holisticRef.current) {
          try {
            await holisticRef.current.send({image: canvas});
            // フレーム処理成功時にカウントを増やす
            videoAnalysisFrameCountRef.current++;
            
            // 進捗状況の計算と更新（より直接的な方法）
            const currentPosition = videoElement.currentTime;
            const totalDuration = videoElement.duration;
            const progressPercent = Math.min(100, Math.max(0, (currentPosition / totalDuration) * 100));
            const now = performance.now();
            const elapsedTime = now - videoAnalysisStartTimeRef.current;
            const fps = videoAnalysisFrameCountRef.current / (elapsedTime / 1000);
            const estimatedRemaining = progressPercent > 0
              ? Math.round((elapsedTime / 1000) * ((100 - progressPercent) / progressPercent))
              : Math.round(totalDuration);
            
            // 状態を直接更新（前の状態を使わず完全に新しい状態を設定）
            setStats({
              framesProcessed: videoAnalysisFrameCountRef.current,
              fps: Math.round(fps),
              elapsedTime: Math.round(elapsedTime / 1000),
              progress: Math.round(progressPercent),
              estimatedTimeRemaining: Math.max(0, estimatedRemaining)
            });
            
            // デバッグログ（重要な情報を常に出力）
            console.log(`進捗状況[直接更新]:`, {
              現在位置: `${currentPosition.toFixed(2)}秒`,
              総時間: `${totalDuration.toFixed(2)}秒`,
              進捗率: `${progressPercent.toFixed(1)}%`,
              計算式: `(${currentPosition.toFixed(2)} / ${totalDuration.toFixed(2)}) * 100 = ${progressPercent.toFixed(1)}%`,
              処理フレーム: videoAnalysisFrameCountRef.current,
              FPS: Math.round(fps)
            });
          } catch (e) {
            console.warn('Holistic送信エラー:', e);
          }
        }
        
        // 動画の終了チェック
        if (videoElement.currentTime >= videoElement.duration - 0.1) {
          console.log('動画分析が完了しました');
          
          // 状態をリセット
          shouldContinueProcessing = false;
          isProcessingFrame = false;
          setIsVideoAnalyzing(false);
          
          // 自動ダウンロードを有効化
          shouldAutoDownloadRef.current = true;
          console.log('自動ダウンロードを有効化しました');

          // 録画開始 - 依存関係問題を回避するために直接呼び出さない
          setTimeout(() => {
            if (uploadedVideoRef.current) {
              uploadedVideoRef.current.currentTime = 0;
              console.log('録画準備完了 - 録画開始ボタンをクリックしてください');
              // ユーザーに録画ボタンをクリックするように指示
              alert('分析が完了しました。「録画開始」ボタンをクリックして録画を開始してください。');
            }
          }, 500);
          
          return;
        }
        
        // 次のフレームに進める（固定のステップサイズ）
        const frameStep = 1 / 24; // 約24fps
        videoElement.currentTime += frameStep;
        
        // シーク完了を待機（より確実な方法）
        await new Promise<void>(resolve => {
          const targetTime = videoElement.currentTime;
          const checkSeek = () => {
            // シークが完了したかを確認
            if (Math.abs(videoElement.currentTime - targetTime) < 0.01) {
              resolve();
            } else {
              requestAnimationFrame(checkSeek);
            }
          };
          checkSeek();
        });
        
        // 次のフレーム処理をスケジュール
        isProcessingFrame = false;
        setTimeout(processFrame, frameProcessingInterval);
        
      } catch (error) {
        // 型安全な方法でエラーを処理
        console.error('フレーム処理エラー:', error);
        isProcessingFrame = false;
        
        // エラーが発生しても処理を継続
        setTimeout(processFrame, frameProcessingInterval);
      }
    };
    
    // 処理開始
    console.log('フレーム処理を開始します');
    videoElement.currentTime = 0; // 必ず0から開始
    processFrame();
    
    // グローバル変数へのアクセスを安全に
    if (typeof window !== 'undefined') {
      // 定期的に統計情報を更新するインターバル（バックアップとして）
      const intervalId = setInterval(() => {
        // 処理内容
      }, 1000);

      // インターバルIDを保存
      videoProcessingIntervalIdRef.current = intervalId;

      return () => {
        if (videoProcessingIntervalIdRef.current) {
          clearInterval(videoProcessingIntervalIdRef.current);
          videoProcessingIntervalIdRef.current = undefined;
        }
      };
    }
  }, [isVideoReady, isVideoAnalyzing]);

  // ランドマーク付きのキャンバスを画像としてダウンロードする関数
  const captureAndDownloadCanvas = useCallback(() => {
    if (!canvasRef.current) {
      console.error('キャンバスが見つかりません');
      return;
    }
    
    try {
      // キャンバスから画像データを取得
      const dataUrl = canvasRef.current.toDataURL('image/png');
      
      // ダウンロード用のリンクを作成
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `motion-analysis-snapshot-${new Date().toISOString().replace(/:/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      alert('スナップショットを保存しました！');
    } catch (error) {
      console.error('スナップショットの保存に失敗しました:', error);
      alert('スナップショットの保存に失敗しました');
    }
  }, []);

  // ランドマーク付き動画を直接ダウンロードする関数（シンプルな実装）
  const captureAndDownloadVideo = useCallback(() => {
    if (!canvasRef.current || !uploadedVideoRef.current) {
      console.error('キャンバスまたは動画が見つかりません');
      alert('キャンバスまたは動画が見つかりません');
      return;
    }
    
    try {
      // 既存のダウンロード関連情報をクリア
      setRecordedChunks([]);
      setOutputVideoUrl(null);
      
      // 動画の再生位置を先頭に戻す
      uploadedVideoRef.current.currentTime = 0;
      
      // 録画設定
      const canvas = canvasRef.current;
      const stream = canvas.captureStream(30); // 30fpsで録画
      
      // MediaRecorderのオプション設定
      const options = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 };
      const mediaRecorder = new MediaRecorder(stream, options);
      
      // データ収集用の配列
      const chunks: Blob[] = [];
      
      // データが利用可能になったら収集
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      // 録画が完了したら動画をダウンロード
      mediaRecorder.onstop = () => {
        // 動画の生成
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        
        // ダウンロードリンクを生成して自動的にクリック
        const a = document.createElement('a');
        a.href = url;
        a.download = `motion-analysis-recording-${new Date().toISOString().replace(/:/g, '-')}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        alert('録画が完了し、動画がダウンロードされました！');
      };
      
      // 動画を再生
      const videoElement = uploadedVideoRef.current;
      videoElement.play();
      
      // ランドマークの処理と描画を開始
      const ctx = canvas.getContext('2d');
      const processFrame = async () => {
        try {
          if (!videoElement.paused && !videoElement.ended) {
            // フレームをキャンバスに描画
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
            ctx?.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            
            // MediaPipeで解析
            if (holisticRef.current) {
              await holisticRef.current.send({ image: canvas });
            }
            
            // 次のフレームを処理
            requestAnimationFrame(processFrame);
          } else if (videoElement.ended) {
            // 動画が終了したら録画を停止
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              mediaRecorderRef.current.stop();
            }
          }
        } catch (e) {
          console.error('フレーム処理エラー:', e);
          requestAnimationFrame(processFrame);
        }
      };
      
      // mediaRecorderRef に現在のレコーダーを保存
      mediaRecorderRef.current = mediaRecorder;
      
      // 録画を開始
      mediaRecorder.start(100); // 100msごとにデータを収集
      
      // フレーム処理を開始
      processFrame();
      
      // ユーザーに録画開始を通知
      alert('ランドマーク付き動画の録画を開始します。動画が終了すると自動的にダウンロードされます。');
      
    } catch (error) {
      console.error('録画の開始に失敗しました:', error);
      alert('録画の開始に失敗しました。ブラウザがこの機能をサポートしていない可能性があります。');
    }
  }, []);

  // ビデオ処理インターバルの設定
  const setVideoProcessingInterval = (callback: () => void, interval: number) => {
    if (videoProcessingIntervalIdRef.current) {
      clearInterval(videoProcessingIntervalIdRef.current);
    }
    videoProcessingIntervalIdRef.current = setInterval(callback, interval);
  };

  // 分析タイマーの設定
  const setAnalysisTimer = (callback: () => void, interval: number) => {
    if (analysisTimerIdRef.current) {
      clearInterval(analysisTimerIdRef.current);
    }
    analysisTimerIdRef.current = setInterval(callback, interval);
  };

  // クリーンアップ関数
  const cleanup = useCallback(() => {
    if (analysisTimerIdRef.current) {
      clearInterval(analysisTimerIdRef.current);
      analysisTimerIdRef.current = undefined;
    }
    if (videoProcessingIntervalIdRef.current) {
      clearInterval(videoProcessingIntervalIdRef.current);
      videoProcessingIntervalIdRef.current = undefined;
    }
  }, []);

  // コンポーネントのアンマウント時にクリーンアップ
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // 出力URLが設定されたらダウンロードを試行
  useEffect(() => {
    if (outputVideoUrl && shouldAutoDownloadRef.current) {
      console.log('outputVideoUrlが設定されました。ダウンロードを試行します:', outputVideoUrl);
      
      // タイムアウトを設定して、ダウンロードを試行
      const downloadTimer = setTimeout(() => {
        console.log('タイマーによるダウンロード開始');
        
        // 直接aタグを作成してダウンロード
        const a = document.createElement('a');
        a.href = outputVideoUrl;
        a.download = `motion-analysis-${new Date().toISOString().replace(/:/g, '-')}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        console.log('ダウンロードリンクをクリックしました');
      }, 1500);
      
      return () => clearTimeout(downloadTimer);
    }
  }, [outputVideoUrl, downloadVideo, analysisMode]);

  // 統計情報のリセット処理
  const resetStats = useCallback(() => {
    setStats({
      framesProcessed: 0,
      fps: 0,
      elapsedTime: 0,
      progress: 0,
      estimatedTimeRemaining: 0
    });
  }, []);

  

  // 動画分析の停止
  const stopVideoAnalysis = useCallback(() => {
    console.log('動画分析を停止します');
    
    // アニメーションフレームをキャンセル
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // インターバルタイマーをクリア
    if (videoProcessingIntervalIdRef.current) {
      clearInterval(videoProcessingIntervalIdRef.current);
      videoProcessingIntervalIdRef.current = undefined;
    }
    
    // 動画を停止
    if (uploadedVideoRef.current) {
      uploadedVideoRef.current.pause();
    }
    
    setIsVideoAnalyzing(false);
    console.log('動画分析を停止しました');
  }, []);

  // メインの処理ループ
  const processVideo = useCallback(async () => {
    if (!uploadedVideoRef.current || !canvasRef.current || !holisticRef.current) {
      console.error('必要なリソースが見つかりません');
      setProcessingStatus('error');
      return;
    }

    const videoElement = uploadedVideoRef.current;
    const canvas = canvasRef.current;
    const holistic = holisticRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      console.error('キャンバスコンテキストを取得できません');
      setProcessingStatus('error');
      return;
    }

    // 処理状態の初期化
    const processor = frameProcessorRef.current;
    processor.isProcessing = true;
    processor.shouldStop = false;
    processor.currentTime = 0;
    processor.processedFrames = 0;
    processor.startTime = performance.now();
    processor.lastUpdateTime = performance.now();

    // 処理完了したら表示モードに切り替え
      if (!processor.shouldStop) {
        setProcessingStatus('completed');
        updateProcessingProgress({
          status: 'completed',
          progress: 100
        });

      // 自動ダウンロードを有効化
      shouldAutoDownloadRef.current = true;
      console.log('自動ダウンロードを有効化しました');

      // 録画開始を促す - 循環依存を避けるために直接呼び出さない
        setTimeout(() => {
          if (uploadedVideoRef.current) {
            uploadedVideoRef.current.currentTime = 0;
          console.log('録画準備完了 - 録画開始ボタンをクリックしてください');
          alert('分析が完了しました。「録画開始」ボタンをクリックして録画を開始してください。');
          }
        }, 500);
      }
  }, [updateProcessingProgress]);

  // 動画アップロード処理
  const handleVideoUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    
    // ファイルサイズチェック（例: 500MB）
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('ファイルサイズが大きすぎます（最大500MB）');
      return;
    }

    // 対応フォーマットチェック
    const supportedFormats = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!supportedFormats.includes(file.type)) {
      alert('対応していないファイル形式です（MP4, WebM, MOVに対応）');
      return;
    }

    try {
      // 処理状態をリセット
      setProcessingStatus('loading');
      updateProcessingProgress({
        status: 'loading',
        progress: 0,
        currentFrame: 0,
        totalFrames: 0,
        fps: 0,
        elapsedTime: 0,
        estimatedTimeRemaining: 0
      });

      // 既存のリソースをクリーンアップ
      if (isVideoAnalyzing) {
        stopVideoAnalysis();
      }
      if (isRecording) {
        stopRecording();
      }
      if (uploadedVideoUrl) {
        URL.revokeObjectURL(uploadedVideoUrl);
      }
      if (outputVideoUrl) {
        URL.revokeObjectURL(outputVideoUrl);
        setOutputVideoUrl(null);
      }
      
      // 自動ダウンロードフラグをリセット
      shouldAutoDownloadRef.current = false;

      // 新しいビデオURLを作成
      const url = URL.createObjectURL(file);
      setUploadedVideoUrl(url);
      setUploadedVideo(file);

      // ビデオの読み込みと初期化
      if (uploadedVideoRef.current) {
        const videoElement = uploadedVideoRef.current;
        
        // メタデータ読み込み完了を待つ
        await new Promise<void>((resolve, reject) => {
          videoElement.onloadedmetadata = () => resolve();
          videoElement.onerror = () => reject(new Error('ビデオの読み込みに失敗しました'));
          videoElement.src = url;
        });

        // キャンバスの設定
        if (canvasRef.current) {
          canvasRef.current.width = videoElement.videoWidth;
          canvasRef.current.height = videoElement.videoHeight;
        }

        // Holisticの初期化
        await initHolistic();

        // 処理開始
        setIsVideoReady(true);
        setIsVideoAnalyzing(true);
        startRenderLoop();
        processVideo(); // startVideoAnalysisの代わりにprocessVideoを使用
      }
    } catch (error) {
      console.error('動画アップロードエラー:', error);
      setProcessingStatus('error');
      updateProcessingProgress({
        status: 'error',
        error: '動画の準備中にエラーが発生しました'
      });
    }
  }, [isVideoAnalyzing, isRecording, stopVideoAnalysis, stopRecording, initHolistic, updateProcessingProgress, processVideo]);

  // 分析モードの切り替えを修正
  const switchMode = useCallback((mode: AnalysisMode) => {
    // 現在の処理を停止
    if (analysisMode === 'camera') {
      if (isRecording) {
        stopRecording();
      }
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      stopRenderLoop();
    } else if (analysisMode === 'video') {
      if (isVideoAnalyzing) {
        stopVideoAnalysis();
      }
      stopRenderLoop();
    }
    
    // モード切り替え
    setAnalysisMode(mode);
    
    // 必要に応じてリソースをクリーンアップ
    if (holisticRef.current) {
      try {
        holisticRef.current.close();
      } catch (e) {
        console.error("Holistic終了エラー:", e);
      }
      holisticRef.current = null;
      setIsInitialized(false);
    }
    
    // 統計リセット
    frameCountRef.current = 0;
    startTimeRef.current = 0;
    videoAnalysisStartTimeRef.current = 0;
    videoAnalysisFrameCountRef.current = 0;
    resetStats();
  }, [analysisMode, isRecording, stopRecording, isVideoAnalyzing, stopVideoAnalysis, resetStats]);

  return (
    <div className="w-full">
      <Card className="shadow-lg bg-white dark:bg-gray-850 border-gray-200 dark:border-gray-800 overflow-hidden">
        <CardHeader className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <CardTitle className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
            <Film className="mr-2 h-5 w-5 text-primary" /> 
            モーション分析ツール
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs defaultValue={analysisMode} onValueChange={(value: string) => setAnalysisMode(value as AnalysisMode)} className="w-full">
            <div className="px-4 pt-4 border-b border-gray-200 dark:border-gray-800">
              <TabsList className="bg-gray-100 dark:bg-gray-800 grid w-full grid-cols-2 h-10 rounded-md">
                <TabsTrigger 
                  value="camera" 
                  className="rounded-sm data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 flex items-center justify-center"
                >
                  <CameraIcon className="mr-2 h-4 w-4" />
                  カメラモード
                </TabsTrigger>
                <TabsTrigger 
                  value="video" 
                  className="rounded-sm data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 flex items-center justify-center"
                >
                  <Video className="mr-2 h-4 w-4" />
                  ビデオモード
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="camera" className="p-4 space-y-4">
              <div className="bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-gray-200 dark:border-gray-800">
                <div className="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0 sm:space-x-4">
                  <div className="flex-1">
                    <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">カメラによる動作分析</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      カメラを起動して、リアルタイムで動作分析を行います
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            size="sm"
                            variant={isInitialized ? "destructive" : "default"}
                            onClick={() => {
                              if (!isInitialized) {
                                // カメラを起動
                                initCamera().then(() => {
                                  setIsInitialized(true);
                                }).catch((err) => {
                                  console.error('カメラ起動エラー:', err);
                                  alert('カメラの起動に失敗しました。権限を確認してください。');
                                });
        } else {
                                // カメラを停止
                                if (cameraRef.current) {
                                  cameraRef.current.stop();
                                  cameraRef.current = null;
                                }
                                if (videoStream) {
                                  videoStream.getTracks().forEach(track => track.stop());
                                  setVideoStream(null);
                                }
            if (holisticRef.current) {
                                  holisticRef.current.close();
                                  holisticRef.current = null;
                                }
                                setIsInitialized(false);
                                resetStats();
                              }
                            }}
                            className="min-w-[120px]"
                            disabled={isLoading}
                          >
                            {isInitialized ? '停止' : 'カメラ起動'}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>カメラを起動または停止します</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            size="sm"
                            variant="secondary"
                            onClick={switchCamera}
                            className="min-w-[140px]"
                            disabled={isLoading}
                          >
                            <RefreshCcw className="mr-2 h-4 w-4" />
                            カメラ切替
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>インカメ/アウトカメを切り替えます（現在: {cameraFacing === 'user' ? 'インカメ' : 'アウトカメ'}）</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            size="sm"
                            variant="outline"
                            onClick={isRecording ? stopRecording : startRecording}
                            className="min-w-[120px]"
                            disabled={!isInitialized || isLoading}
                          >
                            {isRecording ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                録画中...
                              </>
                            ) : (
                              <>録画</>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>カメラ映像を録画します</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
      </div>
      
              <div className="relative aspect-video bg-black rounded-md overflow-hidden">
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
                    <Loader2 className="h-8 w-8 animate-spin text-white" />
                  </div>
                )}
                
                <div className="relative w-full h-full">
            <video
              ref={videoRef}
                    className="w-full h-full object-contain"
              playsInline
              autoPlay
              muted
            />
            <canvas
              ref={canvasRef}
                    className="absolute top-0 left-0 w-full h-full z-10" 
            />
              </div>
          </div>
          
              {processingStatus !== 'idle' && (
                <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-gray-200 dark:border-gray-800">
                  <div className="flex flex-col space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">処理状況</span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {processingProgress.progress.toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={processingProgress.progress} className="h-2" />
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        FPS: {processingProgress.fps.toFixed(1)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 text-right">
                        残り時間: {processingProgress.estimatedTimeRemaining > 0 
                          ? `${Math.round(processingProgress.estimatedTimeRemaining)}秒` 
                          : '計算中...'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(outputVideoUrl || (!isRecording && recordedChunks.length > 0)) && (
                <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-gray-200 dark:border-gray-800">
                  <div className="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
                    <div className="flex-1">
                      <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">録画結果</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        保存またはプレビューが可能です
                      </p>
                    </div>
                    <Button 
                      size="sm"
                      variant="default"
              onClick={downloadVideo}
                      className="min-w-[120px]"
            >
                      <Download className="mr-2 h-4 w-4" />
              ダウンロード
                    </Button>
          </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="video" className="p-4 space-y-4">
              <div className="bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-gray-200 dark:border-gray-800">
                <div className="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0 sm:space-x-4">
                  <div className="flex-1">
                    <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">ビデオによる動作分析</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      動画ファイルをアップロードして分析を行います
                    </p>
          </div>
                  <div className="flex">
                    <Button
                      variant="outline"
                      size="sm"
                      className="relative min-w-[120px]"
                      disabled={isVideoAnalyzing}
                    >
                      <input
                        type="file"
                        accept="video/*"
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        onChange={handleVideoUpload}
                      />
                      <Upload className="mr-2 h-4 w-4" />
                      ビデオ選択
                    </Button>
                  </div>
                </div>
              </div>

              <div className="relative aspect-video bg-black rounded-md overflow-hidden">
                {isVideoAnalyzing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
                    <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      )}
      
                <div className="relative w-full h-full">
            <video
              ref={uploadedVideoRef}
                    className="w-full h-full object-contain"
              playsInline
                    controls
            />
            <canvas
              ref={canvasRef}
                    className="absolute top-0 left-0 w-full h-full z-10" 
                  />
                </div>

                {!uploadedVideoUrl && !isVideoAnalyzing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                    <Upload className="h-12 w-12 mb-4 opacity-50" />
                    <p className="text-lg font-medium opacity-70">ビデオをアップロードしてください</p>
                    <p className="text-sm opacity-50 mt-2">MP4, WebM, MOVなどの形式に対応</p>
              </div>
            )}
                </div>

              {processingStatus !== 'idle' && (
                <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-gray-200 dark:border-gray-800">
                  <div className="flex flex-col space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">処理状況</span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {processingProgress.progress.toFixed(0)}%
                      </span>
              </div>
                    <Progress value={processingProgress.progress} className="h-2" />
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        フレーム: {processingProgress.currentFrame} / {processingProgress.totalFrames}
                </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 text-right">
                        残り時間: {processingProgress.estimatedTimeRemaining > 0 
                          ? `${Math.round(processingProgress.estimatedTimeRemaining)}秒` 
                          : '計算中...'}
                </div>
              </div>
                  </div>

                  {processingStatus === 'completed' && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">処理が完了しました</span>
                        <Button 
                          size="sm"
                          variant="default"
                          onClick={downloadVideo}
                          className="min-w-[120px]"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          ダウンロード
                        </Button>
                      </div>
              </div>
            )}
          </div>
              )}
              
              {/* ビデオモードでも録画結果を表示 */}
              {(outputVideoUrl || (!isRecording && recordedChunks.length > 0)) && (
                <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-gray-200 dark:border-gray-800">
                  <div className="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
                    <div className="flex-1">
                      <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">録画結果</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        ランドマーク付き動画をダウンロードできます
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm"
                        variant="default"
                        onClick={downloadVideo}
                        className="min-w-[120px]"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        ダウンロード
                      </Button>
                      <Button 
                        size="sm"
                        variant="secondary"
                        onClick={exportHighQuality60fps}
                        className="min-w-[160px]"
                      >
                        60fps高画質出力
                      </Button>
                    </div>
            </div>
          </div>
              )}
              {/* デバッグ情報とダウンロードボタン */}
              {processingStatus === 'completed' && (
                <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-gray-200 dark:border-gray-800">
                  <div className="flex flex-col space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-base font-medium text-gray-900 dark:text-gray-100">処理完了</span>
                      <Button 
                        size="sm"
                        variant="default"
                        onClick={downloadVideo}
                        className="min-w-[120px]"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        ダウンロード
                      </Button>
            </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      URL状態: {outputVideoUrl ? '設定済み' : '未設定'}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      自動ダウンロード: {shouldAutoDownloadRef.current ? '有効' : '無効'}
                    </div>
                    {!outputVideoUrl && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={startRecording}
                        className="mt-2"
                      >
                        録画を再試行
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Stats Panel */}
      <Card className="mt-4 shadow-sm bg-white dark:bg-gray-850 border-gray-200 dark:border-gray-800">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 flex items-center">
                <Info className="mr-2 h-4 w-4 text-gray-500" />
                統計情報
              </h3>
              </div>
            <div className="mt-2 md:mt-0 grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">処理フレーム</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.framesProcessed}</p>
            </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">FPS</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.fps}</p>
        </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">経過時間</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.elapsedTime}秒</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 常に表示されるダウンロードボタン */}
      {(outputVideoUrl || (!isRecording && recordedChunks.length > 0)) && (
        <Card className="mt-4 shadow-sm bg-white dark:bg-gray-850 border-gray-200 dark:border-gray-800">
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">動画のダウンロード</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">処理された動画をダウンロードする</p>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="default"
                  onClick={downloadVideo}
                  size="lg"
                  className="bg-green-600 hover:bg-green-700 text-white font-bold"
                >
                  <Download className="mr-2 h-5 w-5" />
                  今すぐダウンロード
                </Button>
                <Button 
                  variant="secondary"
                  onClick={exportHighQuality60fps}
                  size="lg"
                  className="font-bold"
                >
                  60fps高画質出力
                </Button>
              </div>
          </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SimpleMotionAnalyzer; 
