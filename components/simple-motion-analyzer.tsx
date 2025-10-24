'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Download, Upload, Video, Play, Pause, Film, Camera as CameraIcon, Settings, Info, RefreshCcw, Maximize2, Minimize2 } from 'lucide-react';
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
  // スマホのアウトカメラ利用を前提にデフォルトを背面に変更
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('environment');
  // モバイル端末向けのライト(トーチ)制御
  const [isTorchSupported, setIsTorchSupported] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);

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

  // 画面サイズ・フルスクリーン制御
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const cameraContainerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (analysisMode === 'camera' && videoRef.current) {
      if (cameraFacing === 'user') {
        // インカメ時は左右反転して描画（オーバーレイも同じ座標変換下で描画）
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        drawOverlay(ctx, canvas.width, canvas.height);
        ctx.restore();
      } else {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        drawOverlay(ctx, canvas.width, canvas.height);
      }
    } else if (analysisMode === 'video' && uploadedVideoRef.current) {
      ctx.drawImage(uploadedVideoRef.current, 0, 0, canvas.width, canvas.height);
      // アップロード動画は反転しない
      drawOverlay(ctx, canvas.width, canvas.height);
    }
    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, [analysisMode, cameraFacing, drawOverlay]);

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

  // カメラの初期化（明示的にfacingを指定可能）
  const initCamera = useCallback(async (overrideFacing?: 'user' | 'environment') => {
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
      // トーチ状態を初期化
      setIsTorchSupported(false);
      setIsTorchOn(false);
      videoTrackRef.current = null;

      // ユーザーのカメラにアクセス
      const targetFacing = overrideFacing ?? cameraFacing;
      // iOS Safari 等の互換性のため、複数パターンのconstraintsでフォールバック
      const constraintCandidates: MediaStreamConstraints[] = [
        {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            facingMode: { ideal: targetFacing as any }
          },
          audio: false
        },
        {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            facingMode: targetFacing as any
          },
          audio: false
        },
        {
          // 一部端末では exact の方が安定
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            facingMode: { exact: targetFacing as any }
          },
          audio: false
        }
      ];

      console.log('カメラアクセス要求');
      let stream: MediaStream | null = null;
      let lastError: unknown = null;
      for (const c of constraintCandidates) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(c);
          console.log('getUserMedia成功 constraints:', c);
          break;
        } catch (e) {
          lastError = e;
          console.warn('constraintsでの取得に失敗。次の候補を試します:', c, e);
        }
      }

      // すべて失敗した場合、enumerateDevicesからdeviceIdを推測
      if (!stream) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter(d => d.kind === 'videoinput');
          // labelに基づいて背面/前面を推定（権限付与後でないとlabelは空のことあり）
          const pick = (wantEnv: boolean) => {
            const keywords = wantEnv ? ['back', 'rear', 'environment'] : ['front', 'user', 'face'];
            const preferred = videoInputs.find(d => keywords.some(k => d.label.toLowerCase().includes(k))) || null;
            return preferred || videoInputs[wantEnv ? videoInputs.length - 1 : 0] || null;
          };
          const device = pick(targetFacing === 'environment');
          if (device?.deviceId) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: device.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
              audio: false
            });
          }
        } catch (e) {
          lastError = e;
        }
      }

      if (!stream) {
        // 最後の手段として相手側にフォールバック
        const fallback = targetFacing === 'user' ? 'environment' : 'user';
        console.warn('全て失敗。最後に逆向きカメラで試行:', fallback, lastError);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: fallback as any } }, audio: false });
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

      // フレームレート/能力を取得
      const videoTrack = stream.getVideoTracks()[0];
      videoTrackRef.current = videoTrack;
      // Torchサポート確認（Android Chrome系で利用可能な場合あり）
      try {
        const caps: any = (videoTrack as any).getCapabilities?.() || {};
        if (typeof caps.torch !== 'undefined') {
          setIsTorchSupported(true);
        }
      } catch {}
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

        // メタデータ読み込みを待ってからサイズを確定（モバイルでの0x0対策）
        await new Promise<void>((resolve) => {
          const v = videoRef.current!;
          if (v.readyState >= 1 && v.videoWidth && v.videoHeight) {
            resolve();
            return;
          }
          const onLoaded = () => {
            resolve();
          };
          v.addEventListener('loadedmetadata', onLoaded, { once: true });
        });

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
            facingMode: targetFacing
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
      setIsTorchSupported(false);
      setIsTorchOn(false);
      videoTrackRef.current = null;

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
    setIsTorchSupported(false);
    setIsTorchOn(false);
    videoTrackRef.current = null;
    // Holistic を再初期化後、明示的に次の向きでカメラを初期化
    await initHolistic();
    await initCamera(next);
    // 成功したら状態を更新（UI表示の整合性のため）
    setCameraFacing(next);
  }, [cameraFacing, videoStream, initCamera, initHolistic]);

  // トーチのON/OFF
  const toggleTorch = useCallback(async () => {
    try {
      const track = videoTrackRef.current;
      if (!track) return;
      const caps: any = (track as any).getCapabilities?.();
      if (!caps || typeof caps.torch === 'undefined') return;
      const next = !isTorchOn;
      await (track as any).applyConstraints({ advanced: [{ torch: next }] });
      setIsTorchOn(next);
    } catch (e) {
      console.warn('トーチ切替に失敗:', e);
    }
  }, [isTorchOn]);

  // 録画した動画をダウンロード（スマホ対応版）
  const downloadVideo = useCallback(() => {
    console.log('[downloadVideo] 開始');

    let videoUrl = outputVideoUrl;
    let mimeType = recordedMimeType || 'video/webm';

    // URLがない場合は作成
    if (!videoUrl && recordedChunks.length > 0) {
      console.log(`[downloadVideo] URLを作成中...`);
      try {
        if (recordedChunks[0]?.type) {
          mimeType = recordedChunks[0].type;
        }
        const blob = new Blob(recordedChunks, { type: mimeType });
        if (blob.size > 0) {
          videoUrl = URL.createObjectURL(blob);
          setOutputVideoUrl(videoUrl);
          setRecordedMimeType(mimeType);
        }
      } catch (e) {
        console.error('[downloadVideo] Blob作成エラー:', e);
        alert('エラー: 動画データの準備に失敗しました。');
        return;
      }
    }

    if (!videoUrl) {
      alert('ダウンロードする動画がありません。先に録画を行ってください。');
      return;
    }

    // スマホ対応: 新しいタブで開く
    try {
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const filename = `motion-analysis-${new Date().toISOString().replace(/:/g, '-')}.${extension}`;

      // モバイルの場合は新しいウィンドウで開く
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if (isMobile) {
        // モバイル: 新しいタブで動画を開く（長押しで保存可能）
        window.open(videoUrl, '_blank');
        alert('動画を新しいタブで開きました。動画を長押しして「保存」を選択してください。');
      } else {
        // デスクトップ: 通常のダウンロード
        const a = document.createElement('a');
        a.href = videoUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 100);
      }

      console.log('[downloadVideo] 完了');
    } catch (e) {
      console.error('[downloadVideo] エラー:', e);
      alert('動画のダウンロード中にエラーが発生しました。');
    }
  }, [outputVideoUrl, recordedMimeType, recordedChunks]);

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
    // カメラとHolisticもクリーンアップ
    if (cameraRef.current) {
      cameraRef.current.stop();
      cameraRef.current = null;
    }
    if (holisticRef.current) {
      holisticRef.current.close();
      holisticRef.current = null;
    }
    // MediaRecorderも停止
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    // VideoStreamのトラックも停止
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
    }
    // Animation Frameも停止
    stopRenderLoop();
  }, [stopRenderLoop, videoStream]);

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

  // 処理済み動画をダウンロードする関数
  const downloadProcessedVideo = async (videoUrl: string) => {
    try {
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `motion-analysis-${new Date().toISOString().slice(0, 10)}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('ダウンロードエラー:', error);
      alert('ダウンロードに失敗しました');
    }
  };

  // 動画分析を停止する関数（switchModeより前に定義）
  const stopVideoAnalysis = useCallback(() => {
    console.log('動画分析を停止します');

    // 処理フラグを停止
    const processor = frameProcessorRef.current;
    processor.shouldStop = true;
    processor.isProcessing = false;

    // タイマーをクリア
    if (analysisTimerIdRef.current) {
      clearInterval(analysisTimerIdRef.current);
      analysisTimerIdRef.current = undefined;
    }
    if (videoProcessingIntervalIdRef.current) {
      clearInterval(videoProcessingIntervalIdRef.current);
      videoProcessingIntervalIdRef.current = undefined;
    }

    // 動画を停止
    if (uploadedVideoRef.current) {
      uploadedVideoRef.current.pause();
      uploadedVideoRef.current.currentTime = 0;
    }

    // 状態をリセット
    setIsVideoAnalyzing(false);
    setProcessingStatus('idle');

    console.log('動画分析を停止しました');
  }, []);

  // 分析モードの切り替え
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
        // 動画分析を停止
        const processor = frameProcessorRef.current;
        processor.shouldStop = true;
        processor.isProcessing = false;

        if (analysisTimerIdRef.current) {
          clearInterval(analysisTimerIdRef.current);
          analysisTimerIdRef.current = undefined;
        }
        if (videoProcessingIntervalIdRef.current) {
          clearInterval(videoProcessingIntervalIdRef.current);
          videoProcessingIntervalIdRef.current = undefined;
        }

        if (uploadedVideoRef.current) {
          uploadedVideoRef.current.pause();
          uploadedVideoRef.current.currentTime = 0;
        }

        setIsVideoAnalyzing(false);
        setProcessingStatus('idle');
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
  }, [analysisMode, isRecording, stopRecording, isVideoAnalyzing, resetStats, stopRenderLoop]);

  // 動画アップロード処理
  const handleVideoUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('動画ファイルを選択しました:', file.name);

    // 既存の動画をクリア
    if (uploadedVideoUrl) {
      URL.revokeObjectURL(uploadedVideoUrl);
    }

    // 新しい動画URLを作成
    const url = URL.createObjectURL(file);
    setUploadedVideoUrl(url);
    setUploadedVideo(file);
    setIsVideoReady(false);

    // 動画要素にURLを設定
    if (uploadedVideoRef.current) {
      uploadedVideoRef.current.src = url;

      // メタデータ読み込み完了時の処理
      uploadedVideoRef.current.onloadedmetadata = async () => {
        const videoElement = uploadedVideoRef.current;
        if (!videoElement || !canvasRef.current) return;

        console.log('動画メタデータ読み込み完了');

        // キャンバスサイズを動画に合わせる
        canvasRef.current.width = videoElement.videoWidth;
        canvasRef.current.height = videoElement.videoHeight;

        // Holisticを初期化
        const success = await initHolistic();
        if (success) {
          setIsVideoReady(true);
          console.log('動画の準備が完了しました');
          // レンダーループを開始
          startRenderLoop();
        }
      };
    }
  }, [uploadedVideoUrl, initHolistic, startRenderLoop]);


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
          <Tabs defaultValue={analysisMode} onValueChange={(value: string) => switchMode(value as AnalysisMode)} className="w-full">
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
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                  <div className="flex-1">
                    <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">カメラによる動作分析</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      カメラを起動して、リアルタイムで動作分析を行います
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="default"
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
                            className="min-w-[140px]"
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
                            size="default"
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

                    {isTorchSupported && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="default"
                              variant={isTorchOn ? 'destructive' : 'outline'}
                              onClick={toggleTorch}
                              className="min-w-[120px]"
                              disabled={isLoading}
                            >
                              {isTorchOn ? 'ライトOFF' : 'ライトON'}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>背面ライト（トーチ）を{isTorchOn ? 'オフ' : 'オン'}にします</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="default"
                            variant="outline"
                            onClick={isRecording ? stopRecording : startRecording}
                            className="min-w-[140px]"
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
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="default"
                            variant="ghost"
                            onClick={toggleFullscreen}
                            className="min-w-[44px]"
                            disabled={isLoading}
                            aria-label={isFullscreen ? '縮小' : '全画面'}
                          >
                            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{isFullscreen ? '縮小表示に戻す' : 'プレビューを全画面表示'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
      </div>

              <div
                ref={cameraContainerRef}
                className={[
                  'relative bg-black rounded-md overflow-hidden',
                  isFullscreen ? 'fixed inset-0 z-50 m-0 rounded-none' : 'w-full min-h-[55vh] md:min-h-[65vh]'
                ].join(' ')}
              >
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-20">
                    <Loader2 className="h-8 w-8 animate-spin text-white" />
                  </div>
                )}

                <div className="absolute inset-0">
            <video
              ref={videoRef}
                    className="w-full h-full object-contain"
              style={{ transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none' }}
              playsInline
              autoPlay
              muted
            />
            <canvas
              ref={canvasRef}
                    className="absolute top-0 left-0 w-full h-full z-10 pointer-events-none"
            />
                </div>

                <div className="absolute top-2 right-2 z-30">
                  <Button size="icon" variant="secondary" onClick={toggleFullscreen} aria-label={isFullscreen ? '縮小' : '全画面'}>
                    {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
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
                <div className="mt-4 bg-green-50 dark:bg-green-900/20 rounded-md p-4 border-2 border-green-500 dark:border-green-600">
                  <div className="flex flex-col space-y-3">
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-green-900 dark:text-green-100">✓ 録画完了</h3>
                      <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                        スマホの場合: ボタンをタップして動画を開き、長押しで保存してください
                      </p>
                    </div>
                    <Button
                      size="lg"
                      variant="default"
                      onClick={downloadVideo}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold text-base py-6"
                    >
                      <Download className="mr-2 h-5 w-5" />
                      動画を保存する
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
                  <div className="flex gap-2">
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
                    {uploadedVideoUrl && isVideoReady && !isVideoAnalyzing && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={startVideoAnalysis}
                        className="min-w-[120px]"
                      >
                        <Play className="mr-2 h-4 w-4" />
                        分析開始
                      </Button>
                    )}
                    {isVideoAnalyzing && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={stopVideoAnalysis}
                        className="min-w-[120px]"
                      >
                        <Pause className="mr-2 h-4 w-4" />
                        分析停止
                      </Button>
                    )}
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
                <div className="mt-4 bg-green-50 dark:bg-green-900/20 rounded-md p-4 border-2 border-green-500 dark:border-green-600">
                  <div className="flex flex-col space-y-3">
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-green-900 dark:text-green-100">✓ 録画完了</h3>
                      <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                        スマホの場合: ボタンをタップして動画を開き、長押しで保存してください
                      </p>
                    </div>
                    <Button
                      size="lg"
                      variant="default"
                      onClick={downloadVideo}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold text-base py-6"
                    >
                      <Download className="mr-2 h-5 w-5" />
                      動画を保存する
                    </Button>
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


    </div>
  );
};

export default SimpleMotionAnalyzer;