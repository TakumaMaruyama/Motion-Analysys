'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Download, Upload, Video, Play, Pause, Film, Camera as CameraIcon, Settings, Info, RefreshCcw, Maximize2, Minimize2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';

// MediaPipeの型定義 - useStateで管理することでHMRの問題を回避

type AnalysisMode = 'camera' | 'video';

interface ProcessedFrame {
  imageData: ImageData;
  timestamp: number;
  sourceTime: number;
  index: number;
  metadata: {
    processingTime: number;
    captureTime: number;
    quality: number;
  };
}

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

export const SimpleMotionAnalyzer: React.FC = () => {
  // MediaPipeモジュールの状態管理
  const [mediaModules, setMediaModules] = useState<{
    Holistic: any;
    Camera: any;
    drawLandmarks: any;
    drawConnectors: any;
    POSE_CONNECTIONS: any;
    HAND_CONNECTIONS: any;
    FACEMESH_TESSELATION: any;
  } | null>(null);

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

  // MediaPipeモジュールの初期化
  useEffect(() => {
    let mounted = true;
    
    const loadModules = async () => {
      try {
        console.log('MediaPipeモジュールを読み込み中...');
        const [holisticModule, cameraModule, drawingModule] = await Promise.all([
          import('@mediapipe/holistic'),
          import('@mediapipe/camera_utils'),
          import('@mediapipe/drawing_utils')
        ]);
        
        if (mounted) {
          setMediaModules({
            Holistic: holisticModule.Holistic,
            Camera: cameraModule.Camera,
            drawLandmarks: drawingModule.drawLandmarks,
            drawConnectors: drawingModule.drawConnectors,
            POSE_CONNECTIONS: holisticModule.POSE_CONNECTIONS,
            HAND_CONNECTIONS: holisticModule.HAND_CONNECTIONS,
            FACEMESH_TESSELATION: holisticModule.FACEMESH_TESSELATION
          });
          console.log('MediaPipeモジュールの読み込み完了');
        }
      } catch (err) {
        console.error('MediaPipeの読み込みに失敗:', err);
        if (mounted) {
          alert('MediaPipeの読み込みに失敗しました。ページを再読み込みしてください。');
        }
      }
    };
    
    loadModules();
    
    return () => {
      mounted = false;
    };
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
    if (!results || !mediaModules) return;

    const { drawConnectors, drawLandmarks, POSE_CONNECTIONS, HAND_CONNECTIONS, FACEMESH_TESSELATION } = mediaModules;

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
  }, [mediaModules]);

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

      if (!mediaModules) {
        throw new Error('MediaPipeライブラリが読み込まれていません');
      }

      const { Holistic } = mediaModules;

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
  }, [analysisMode, mediaModules]);

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
        if (holisticRef.current && mediaModules) {
          console.log('Camera-Holistic接続を設定');
          const { Camera } = mediaModules;
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
  }, [initHolistic, videoStream, cameraFacing, mediaModules, startRenderLoop]);

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

  // 録画した動画をダウンロード（スマホ完全対応版）
  const downloadVideo = useCallback(() => {
    console.log('[downloadVideo] 開始');

    // Blobを作成または取得
    let videoBlob: Blob | null = null;
    let mimeType = 'video/webm';

    if (outputVideoUrl) {
      // 既存のURLからBlobを再取得（fetch経由）
      fetch(outputVideoUrl)
        .then(res => res.blob())
        .then(blob => {
          videoBlob = blob;
          mimeType = blob.type || recordedMimeType || 'video/webm';
          performDownload(videoBlob, mimeType);
        })
        .catch(err => {
          console.error('URLからBlobの取得に失敗:', err);
          // フォールバック: recordedChunksから作成
          if (recordedChunks.length > 0) {
            createAndDownloadFromChunks();
          } else {
            alert('動画データが見つかりません');
          }
        });
    } else if (recordedChunks.length > 0) {
      createAndDownloadFromChunks();
    } else {
      alert('録画データがありません。まず録画を開始してください。');
    }

    function createAndDownloadFromChunks() {
      const mime = recordedMimeType || recordedChunks[0]?.type || 'video/webm';
      const blob = new Blob(recordedChunks, { type: mime });
      performDownload(blob, mime);
    }

    function performDownload(blob: Blob, mime: string) {
      const url = URL.createObjectURL(blob);
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      
      console.log(`[downloadVideo] デバイス判定: ${isMobile ? 'モバイル' : 'デスクトップ'}, iOS: ${isIOS}`);

      if (isIOS) {
        // iOS: 新しいタブで開いて共有メニューから保存する方法
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';
        
        const container = document.createElement('div');
        container.style.cssText = 'width:100%;max-width:600px;display:flex;flex-direction:column;align-items:center;';
        
        const title = document.createElement('h2');
        title.textContent = '動画を保存する方法';
        title.style.cssText = 'color:white;font-size:24px;font-weight:bold;margin-bottom:20px;text-align:center;';
        
        const instruction = document.createElement('div');
        instruction.style.cssText = 'color:white;font-size:16px;margin-bottom:20px;text-align:center;line-height:1.8;background:rgba(255,255,255,0.1);padding:20px;border-radius:10px;';
        instruction.innerHTML = `
          <p style="margin-bottom:15px;font-size:18px;font-weight:bold;color:#4ade80;">📱 iPhoneでの保存方法</p>
          <p style="margin-bottom:10px;">1️⃣ 下の<span style="color:#fbbf24;font-weight:bold;">「動画を開く」</span>ボタンをタップ</p>
          <p style="margin-bottom:10px;">2️⃣ 新しいタブで動画が開きます</p>
          <p style="margin-bottom:10px;">3️⃣ 画面下の<span style="color:#fbbf24;font-weight:bold;">共有ボタン📤</span>をタップ</p>
          <p style="margin-bottom:10px;">4️⃣ <span style="color:#fbbf24;font-weight:bold;">「ビデオを保存」</span>を選択✅</p>
          <p style="margin-top:15px;font-size:14px;color:#d1d5db;">※ 共有ボタンは画面の下部中央にあります</p>
        `;
        
        const openButton = document.createElement('a');
        openButton.href = url;
        openButton.target = '_blank';
        openButton.textContent = '📱 動画を開く';
        openButton.style.cssText = 'display:block;padding:20px 60px;font-size:20px;background:#10b981;color:white;border:none;border-radius:12px;cursor:pointer;font-weight:bold;text-decoration:none;text-align:center;margin:20px 0;box-shadow:0 4px 20px rgba(16,185,129,0.5);';
        
        const previewText = document.createElement('p');
        previewText.textContent = 'プレビュー:';
        previewText.style.cssText = 'color:white;font-size:14px;margin-top:30px;margin-bottom:10px;';
        
        const videoElement = document.createElement('video');
        videoElement.src = url;
        videoElement.controls = true;
        videoElement.playsInline = true;
        videoElement.style.cssText = 'width:100%;max-width:500px;margin-bottom:20px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
        
        const closeButton = document.createElement('button');
        closeButton.textContent = '閉じる';
        closeButton.style.cssText = 'margin-top:10px;padding:12px 40px;font-size:16px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;box-shadow:0 2px 10px rgba(239,68,68,0.5);';
        closeButton.onclick = () => {
          document.body.removeChild(overlay);
          URL.revokeObjectURL(url);
        };
        
        container.appendChild(title);
        container.appendChild(instruction);
        container.appendChild(openButton);
        container.appendChild(previewText);
        container.appendChild(videoElement);
        container.appendChild(closeButton);
        overlay.appendChild(container);
        document.body.appendChild(overlay);
        
      } else if (isMobile) {
        // Android: 複数の方法を試行
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';
        
        const container = document.createElement('div');
        container.style.cssText = 'width:100%;max-width:600px;display:flex;flex-direction:column;align-items:center;';
        
        const title = document.createElement('h2');
        title.textContent = '動画を保存する';
        title.style.cssText = 'color:white;font-size:24px;font-weight:bold;margin-bottom:20px;text-align:center;';
        
        const instruction = document.createElement('div');
        instruction.style.cssText = 'color:white;font-size:16px;margin-bottom:20px;text-align:center;line-height:1.8;background:rgba(255,255,255,0.1);padding:20px;border-radius:10px;';
        instruction.innerHTML = `
          <p style="margin-bottom:15px;font-size:18px;font-weight:bold;color:#4ade80;">📱 Androidでの保存方法</p>
          <p style="margin-bottom:10px;">以下のボタンから保存してください</p>
        `;
        
        const videoElement = document.createElement('video');
        videoElement.src = url;
        videoElement.controls = true;
        videoElement.playsInline = true;
        videoElement.style.cssText = 'width:100%;max-width:500px;margin:20px 0;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
        
        const downloadButton = document.createElement('a');
        downloadButton.href = url;
        downloadButton.download = `motion-analysis-${Date.now()}.webm`;
        downloadButton.textContent = '📥 ダウンロード';
        downloadButton.style.cssText = 'display:block;padding:15px 40px;font-size:18px;background:#10b981;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;text-decoration:none;text-align:center;margin-bottom:10px;box-shadow:0 2px 10px rgba(16,185,129,0.5);';
        
        const openButton = document.createElement('button');
        openButton.textContent = '🔗 新しいタブで開く';
        openButton.style.cssText = 'padding:12px 40px;font-size:16px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;margin-bottom:10px;box-shadow:0 2px 10px rgba(59,130,246,0.5);';
        openButton.onclick = () => {
          window.open(url, '_blank');
        };
        
        const helpText = document.createElement('p');
        helpText.textContent = '※ ダウンロードが始まらない場合は、「新しいタブで開く」から動画を長押しして保存してください';
        helpText.style.cssText = 'color:#d1d5db;font-size:14px;text-align:center;margin:15px 0;';
        
        const closeButton = document.createElement('button');
        closeButton.textContent = '閉じる';
        closeButton.style.cssText = 'margin-top:10px;padding:12px 40px;font-size:16px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;box-shadow:0 2px 10px rgba(239,68,68,0.5);';
        closeButton.onclick = () => {
          document.body.removeChild(overlay);
          URL.revokeObjectURL(url);
        };
        
        container.appendChild(title);
        container.appendChild(instruction);
        container.appendChild(videoElement);
        container.appendChild(downloadButton);
        container.appendChild(openButton);
        container.appendChild(helpText);
        container.appendChild(closeButton);
        overlay.appendChild(container);
        document.body.appendChild(overlay);
        
      } else {
        // デスクトップ: 通常のダウンロード
        const extension = mime.includes('mp4') ? 'mp4' : 'webm';
        const a = document.createElement('a');
        a.href = url;
        a.download = `motion-analysis-${Date.now()}.${extension}`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      }
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
    alert('この機能は現在開発中です。通常のダウンロードをご利用ください。');
    return;
  }, []);

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
      const stream = canvasRef.current.captureStream(captureFps);

      // モバイル対応: MP4を優先、次にWebM
      const supportedTypes = [
        'video/mp4',
        'video/webm;codecs=h264', // H.264コーデック付きWebM
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
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
        videoBitsPerSecond: 5000000
      };

      console.log('[startRecording] MediaRecorderを初期化します', options);
      const mediaRecorder = new MediaRecorder(stream, options);

      // データが利用可能になったときのイベントハンドラ
      mediaRecorder.ondataavailable = (event) => {
        console.log(`[ondataavailable] データチャンク取得: サイズ=${event.data.size} bytes, タイプ=${event.data.type}`);
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
          console.log(`[ondataavailable] ローカルchunks配列に追加: 現在${chunks.length}個`);

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
        console.log(`[onstop] 録画停止 - ローカルchunks: ${chunks.length}個`);

        if (chunks.length === 0) {
          console.error('[onstop] ローカルchunksが空です');
          if (recordedChunks.length > 0) {
            console.log(`[onstop] recordedChunksを使用します`);
            const blob = new Blob(recordedChunks, { type: mimeType });
            console.log(`[onstop] Blobを作成: サイズ=${blob.size} bytes`);
            const videoUrl = URL.createObjectURL(blob);
            setOutputVideoUrl(videoUrl);
            setRecordedMimeType(mimeType);
            } else {
            console.error('[onstop] recordedChunksも空です');
            alert('録画データが取得できませんでした');
          }
          setIsRecording(false);
          return;
        }

        // Blobを作成（MP4の場合は特別な処理）
        const blob = new Blob(chunks, { type: mimeType });
        console.log(`[onstop] Blobを作成: サイズ=${blob.size} bytes, タイプ=${blob.type}`);

        if (blob.size === 0) {
          console.error('[onstop] Blobのサイズが0です');
          setIsRecording(false); 
          alert('録画データが空です');
          return;
        }

        const videoUrl = URL.createObjectURL(blob);
        console.log(`[onstop] URL生成: ${videoUrl}`);

        setOutputVideoUrl(videoUrl);
        setRecordedMimeType(mimeType);
        setRecordedChunks(chunks);
        setIsRecording(false);

        console.log('[onstop] 録画完了');
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100);
      setIsRecording(true);
      console.log('[startRecording] 録画を開始しました');

      // HQエクスポート用のフレーム収集
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

    } catch (error) {
      console.error('[startRecording] エラー:', error);
      setIsRecording(false);
      alert(`録画中にエラーが発生しました: ${error}`);
    }
  }, [canvasRef, isRecording, recordedChunks]);

  // 動画分析の停止処理
  const stopVideoAnalysis = useCallback(() => {
    console.log('動画分析を停止します');
    
    // フレーム処理を停止
    const processor = frameProcessorRef.current;
    processor.shouldStop = true;
    processor.isProcessing = false;
    
    // インターバルをクリア
    if (videoProcessingIntervalIdRef.current) {
      clearInterval(videoProcessingIntervalIdRef.current);
      videoProcessingIntervalIdRef.current = undefined;
    }
    
    // 動画を一時停止
    if (uploadedVideoRef.current) {
      uploadedVideoRef.current.pause();
    }
    
    // 状態をリセット
    setIsVideoAnalyzing(false);
    setProcessingStatus('idle');
    
    console.log('動画分析を停止しました');
  }, []);

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


  // 分析モードでの動画処理
  const processVideo = useCallback(async () => {
    if (!uploadedVideoRef.current || !canvasRef.current || !holisticRef.current) {
      console.error('必要なリソースが見つかりません');
      setProcessingStatus('error');
      return;
    }

    const videoElement = uploadedVideoRef.current;
    const holistic = holisticRef.current;
    const duration = isFinite(videoElement.duration) ? videoElement.duration : 0;

    // 状態初期化
    const processor = frameProcessorRef.current;
    processor.isProcessing = true;
    processor.shouldStop = false;
    processor.currentTime = 0;
    processor.processedFrames = 0;
    processor.startTime = performance.now();
    processor.lastUpdateTime = performance.now();

    setProcessingStatus('processing');
    updateProcessingProgress({ status: 'processing', progress: 0, currentFrame: 0, totalFrames: 0, fps: 0, elapsedTime: 0, estimatedTimeRemaining: Math.max(0, Math.round(duration)) });

    // キャンバス録画を自動開始（出力動画生成のため）
    if (!isRecording) {
      try {
        startRecording();
      } catch (e) {
        console.warn('自動録画開始に失敗しましたが処理は継続します:', e);
      }
    }

    // 解析用ループ（過負荷を避けるために重複送信を防止）
    let sending = false;
    const targetFps = 24; // 処理用のターゲットFPS
    const intervalMs = Math.max(10, Math.round(1000 / targetFps));

    const intervalId = setInterval(async () => {
      if (processor.shouldStop) return;
      if (!uploadedVideoRef.current || !holisticRef.current) return;
      if (videoElement.paused || videoElement.ended) return;
      if (sending) return;

      try {
        sending = true;
        await holistic.send({ image: videoElement });
        processor.processedFrames += 1;

        // 進捗更新
        const cur = videoElement.currentTime;
        const total = videoElement.duration || duration || 1;
        const elapsedMs = performance.now() - processor.startTime;
        const fps = processor.processedFrames / Math.max(0.001, elapsedMs / 1000);
        const progress = Math.min(100, Math.max(0, (cur / total) * 100));
        const eta = progress > 0 ? (elapsedMs / 1000) * ((100 - progress) / progress) : Math.round(total);
        updateProcessingProgress({ status: 'processing', progress: Math.round(progress), currentFrame: processor.processedFrames, fps: Math.round(fps), elapsedTime: Math.round(elapsedMs / 1000), estimatedTimeRemaining: Math.max(0, Math.round(eta)) });
      } catch (e) {
        console.warn('holistic.send エラー:', e);
      } finally {
        sending = false;
      }
    }, intervalMs);

    // 再生と完了処理
    const handleEnded = () => {
      try {
        processor.shouldStop = true;
        clearInterval(intervalId);
        setProcessingStatus('completed');
        updateProcessingProgress({ status: 'completed', progress: 100 });
      } finally {
        // 録画停止（出力URLは onstop ハンドラで生成される）
        stopRecording();
        videoElement.removeEventListener('ended', handleEnded);
      }
    };

    videoElement.addEventListener('ended', handleEnded, { once: true });
    try {
      videoElement.currentTime = 0;
      await videoElement.play();
    } catch (e) {
      console.error('動画の自動再生に失敗しました。ユーザー操作が必要です:', e);
    }
  }, [startRecording, stopRecording, updateProcessingProgress]);

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
  }, [stopVideoAnalysis, stopRecording, initHolistic, startRenderLoop, processVideo]);

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

              {/* ビデオ処理完了時の保存ボタン - 大きく目立つように */}
              {processingStatus === 'completed' && (
                <div className="mt-4 bg-green-50 dark:bg-green-900/20 rounded-lg p-6 border-2 border-green-500 dark:border-green-700">
                  <div className="flex flex-col items-center space-y-4">
                    <div className="text-center">
                      <h3 className="text-xl font-bold text-green-800 dark:text-green-300 mb-2">
                        ✓ 処理が完了しました！
                      </h3>
                      <p className="text-sm text-green-700 dark:text-green-400">
                        ランドマーク付き動画をダウンロードできます
                      </p>
                    </div>
                    <Button
                      size="lg"
                      variant="default"
                      onClick={downloadVideo}
                      className="bg-green-600 hover:bg-green-700 text-white font-bold text-lg px-8 py-6 min-w-[250px]"
                    >
                      <Download className="mr-3 h-6 w-6" />
                      動画を保存する
                    </Button>
                    <div className="text-xs text-green-600 dark:text-green-400 text-center">
                      <p>処理フレーム数: {stats.framesProcessed}</p>
                      <p>処理時間: {stats.elapsedTime}秒</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 処理中は録画開始ボタンを表示 */}
              {processingStatus === 'processing' && !isRecording && (
                <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-500 dark:border-blue-700">
                  <div className="flex flex-col items-center space-y-3">
                    <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
                      動画の解析が完了したら、録画を開始してください
                    </p>
                    <Button
                      size="default"
                      variant="default"
                      onClick={startRecording}
                      disabled={isRecording}
                      className="min-w-[180px]"
                    >
                      {isRecording ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          録画中...
                        </>
                      ) : (
                        <>録画開始</>
                      )}
                    </Button>
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