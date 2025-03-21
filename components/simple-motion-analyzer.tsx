'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Download, Upload, Video, Play, Pause, Film } from 'lucide-react';
import { Holistic, POSE_CONNECTIONS, HAND_CONNECTIONS, FACEMESH_TESSELATION } from '@mediapipe/holistic';
import { Camera } from '@mediapipe/camera_utils';
import { drawLandmarks, drawConnectors } from '@mediapipe/drawing_utils';

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
  const [originalFrameRate, setOriginalFrameRate] = useState<number>(30);
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null);
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [isVideoAnalyzing, setIsVideoAnalyzing] = useState<boolean>(false);
  const [isVideoReady, setIsVideoReady] = useState<boolean>(false);

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
  const frameCountRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const videoAnalysisStartTimeRef = useRef<number>(0);
  const videoAnalysisFrameCountRef = useRef<number>(0);
  const shouldAutoDownloadRef = useRef<boolean>(false);

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
        if (!canvasRef.current) return;
        
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;
        
        // キャンバスをクリア
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        
        // 背景として元のビデオフレームを描画
        if (analysisMode === 'camera' && videoRef.current) {
          ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
        } else if (analysisMode === 'video' && uploadedVideoRef.current) {
          ctx.drawImage(uploadedVideoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
        }
        
        // 顔のメッシュを描画
        if (results.faceLandmarks) {
          drawConnectors(ctx, results.faceLandmarks, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });
        }
        
        // 姿勢のコネクターとランドマークを描画
        if (results.poseLandmarks) {
          drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
          drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 1 });
        }
        
        // 左手のコネクターとランドマークを描画
        if (results.leftHandLandmarks) {
          drawConnectors(ctx, results.leftHandLandmarks, HAND_CONNECTIONS, { color: '#CC0000', lineWidth: 2 });
          drawLandmarks(ctx, results.leftHandLandmarks, { color: '#00FF00', lineWidth: 1 });
        }
        
        // 右手のコネクターとランドマークを描画
        if (results.rightHandLandmarks) {
          drawConnectors(ctx, results.rightHandLandmarks, HAND_CONNECTIONS, { color: '#00CC00', lineWidth: 2 });
          drawLandmarks(ctx, results.rightHandLandmarks, { color: '#FF0000', lineWidth: 1 });
        }
        
        // フレームカウンタを更新
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
      await holistic.initialize();
      console.log('Holistic初期化完了');
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
          frameRate: { ideal: 30 }
        },
        audio: false
      };
      
      console.log('カメラアクセス要求');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setVideoStream(stream);
      
      // フレームレートを取得
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      const actualFrameRate = settings.frameRate || 30;
      setOriginalFrameRate(actualFrameRate);
      console.log('取得したフレームレート:', actualFrameRate);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        console.log('ビデオに接続、再生開始');
        await videoRef.current.play();
        
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
                try {
                  await holisticRef.current.send({ image: videoRef.current });
                } catch (e) {
                  console.error("Holistic処理エラー:", e);
                }
              }
            },
            width: videoRef.current.videoWidth,
            height: videoRef.current.videoHeight
          });
          
          console.log('カメラ開始');
          await cameraRef.current.start();
          console.log('カメラ開始完了');
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
  }, [initHolistic, videoStream]);

  // 動画ダウンロード関数を先に定義
  const downloadVideo = useCallback(() => {
    if (!outputVideoUrl) {
      console.log('ダウンロードするURLがありません');
      return;
    }
    
    console.log('ダウンロード処理開始');
    
    // 常にWebM形式として保存
    const extension = 'webm';
    
    const a = document.createElement('a');
    a.href = outputVideoUrl;
    a.download = `motion-analysis-${new Date().toISOString()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('ダウンロード処理完了');
  }, [outputVideoUrl]);

  // 録画停止
  const stopRecording = useCallback(() => {
    console.log('録画停止処理');
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      console.log('MediaRecorderを停止');
      
      // 録画停止後の自動ダウンロードフラグを設定
      shouldAutoDownloadRef.current = true;
      
      // オリジナルのonstopハンドラを保存
      const originalOnStop = mediaRecorderRef.current.onstop;
      
      // 新しいonstopハンドラを設定
      mediaRecorderRef.current.onstop = (event) => {
        // オリジナルのハンドラを呼び出し
        if (originalOnStop) {
          if (mediaRecorderRef.current) {
            originalOnStop.call(mediaRecorderRef.current, event);
          }
        }
        
        // 自動ダウンロード
        setTimeout(() => {
          if (outputVideoUrl) {
            downloadVideo();
            // 処理完了メッセージを表示
            alert('分析が完了し、動画が自動的にダウンロードされました');
          }
        }, 1000); // 1秒待ってダウンロード
      };
      
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
    } else {
      console.log('停止するMediaRecorderがない');
    }
  }, [downloadVideo, outputVideoUrl]);

  // 録画開始
  const startRecording = useCallback(() => {
    if (!canvasRef.current) {
      console.error('キャンバスが見つかりません');
      return;
    }
    
    if (isRecording) {
      console.log('すでに録画中です');
      return;
    }
    
    console.log('録画開始処理');
    setRecordedChunks([]);
    setOutputVideoUrl(null);
    frameCountRef.current = 0;
    startTimeRef.current = 0;
    
    try {
      // ストリームの取得（モードによって処理を分ける）
      console.log('キャンバスからストリーム取得 フレームレート:', originalFrameRate);
      
      // キャンバスからストリームを取得する
      const stream = canvasRef.current.captureStream(originalFrameRate);
      
      if (!stream || stream.getVideoTracks().length === 0) {
        console.error('ストリームまたはビデオトラックの取得に失敗');
        return;
      }
      
      console.log(`取得したストリーム: トラック数=${stream.getTracks().length}`);
      
      // コーデックの対応確認
      let options = {};
      const supportedTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          options = {
            mimeType: type,
            videoBitsPerSecond: 5000000
          };
          console.log(`${type}コーデック利用`);
          break;
        }
      }
      
      // MediaRecorderインスタンスの作成
      console.log('MediaRecorder作成', options);
      const mediaRecorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];
      
      // データ取得イベントハンドラ
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          console.log(`データチャンクサイズ: ${e.data.size} バイト`);
          chunks.push(e.data);
          setRecordedChunks(current => [...current, e.data]);
        } else {
          console.warn('空のデータチャンク');
        }
      };
      
      // 録画停止イベントハンドラ
      mediaRecorder.onstop = () => {
        console.log(`録画終了、録画チャンク数: ${chunks.length}`);
        
        if (chunks.length === 0) {
          console.error('録画データがありません');
          return;
        }
        
        // Blobの作成
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        console.log(`Blob作成: MIMEタイプ=${mimeType}`);
        const blob = new Blob(chunks, { type: mimeType });
        
        console.log(`最終Blobサイズ: ${blob.size} バイト、タイプ: ${blob.type}`);
        
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          console.log('Blob URL作成:', url);
          setOutputVideoUrl(url);
        } else {
          console.error('Blobのサイズが0です');
        }
      };
      
      // エラーハンドリング
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorderエラー:', event);
      };
      
      // 録画開始
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000); // 1秒ごとにデータを取得
      console.log('録画開始: ', mediaRecorder.mimeType);
      setIsRecording(true);
    } catch (error) {
      console.error('録画の開始に失敗しました:', error);
    }
  }, [isRecording, originalFrameRate]);

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
          
          // 録画を開始
          setTimeout(() => {
            if (uploadedVideoRef.current) {
              uploadedVideoRef.current.currentTime = 0;
              startRecording();
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
  }, [isVideoReady, isVideoAnalyzing, startRecording]);
  
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

  // 動画処理の進捗更新
  const updateProcessingProgress = useCallback((updates: Partial<ProcessingProgress>) => {
    setProcessingProgress(prev => ({
      ...prev,
      ...updates
    }));
  }, []);

  // フレーム処理の実行
  const processVideoFrame = useCallback(async (
    videoElement: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    holistic: Holistic,
    onProgress: (progress: number) => void
  ): Promise<boolean> => {
    try {
      // フレームをキャンバスに描画
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      // MediaPipe Holisticで解析
      await holistic.send({image: canvas});

      return true;
    } catch (error) {
      console.error('フレーム処理エラー:', error);
      return false;
    }
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

    // 動画の情報を取得
    const duration = videoElement.duration;
    const frameStep = 1 / 30; // 30fps
    const totalFrames = Math.ceil(duration / frameStep);
    const chunkSize = 1; // 1秒ごとにチャンク処理

    // 進捗情報を初期化
    updateProcessingProgress({
      status: 'processing',
      progress: 0,
      currentFrame: 0,
      totalFrames,
      fps: 0,
      elapsedTime: 0,
      estimatedTimeRemaining: duration
    });

    // 最初のフレームに移動
    videoElement.currentTime = 0;

    // チャンク単位で処理を実行
    const processChunk = async (startTime: number, endTime: number): Promise<void> => {
      if (processor.shouldStop) {
        return;
      }

      try {
        // チャンク内のフレームを処理
        let currentTime = startTime;
        while (currentTime < endTime && !processor.shouldStop) {
          // フレームの描画と解析
          videoElement.currentTime = currentTime;
          
          // シーク完了を待機
          await new Promise<void>(resolve => {
            const checkSeek = () => {
              if (Math.abs(videoElement.currentTime - currentTime) < 0.01) {
                resolve();
              } else {
                requestAnimationFrame(checkSeek);
              }
            };
            checkSeek();
          });

          // フレーム処理
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          
          try {
            await holistic.send({image: canvas});
          } catch (e) {
            console.warn('Holistic処理エラー:', e);
          }

          processor.processedFrames++;
          processor.currentTime = currentTime;

          // 進捗更新
          const now = performance.now();
          if (now - processor.lastUpdateTime > 200) {
            const elapsedTime = (now - processor.startTime) / 1000;
            const progress = (currentTime / duration) * 100;
            const currentFps = processor.processedFrames / elapsedTime;
            const estimatedTimeRemaining = progress > 0
              ? (elapsedTime * (100 - progress)) / progress
              : duration;

            updateProcessingProgress({
              progress: Math.round(progress),
              currentFrame: processor.processedFrames,
              fps: Math.round(currentFps),
              elapsedTime: Math.round(elapsedTime),
              estimatedTimeRemaining: Math.round(estimatedTimeRemaining)
            });

            processor.lastUpdateTime = now;
          }

          currentTime += frameStep;
          
          // UIの更新のために少し待機
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } catch (error) {
        console.error('チャンク処理エラー:', error);
      }
    };

    try {
      // 動画を複数のチャンクに分割して処理
      for (let time = 0; time < duration && !processor.shouldStop; time += chunkSize) {
        const endTime = Math.min(time + chunkSize, duration);
        await processChunk(time, endTime);
        
        // チャンク間で少し待機してUIの更新を許可
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // 処理完了
      if (!processor.shouldStop) {
        setProcessingStatus('completed');
        updateProcessingProgress({
          status: 'completed',
          progress: 100
        });

        // 録画開始
        setTimeout(() => {
          if (uploadedVideoRef.current) {
            uploadedVideoRef.current.currentTime = 0;
            startRecording();
          }
        }, 500);
      }
    } catch (error) {
      console.error('動画処理エラー:', error);
      setProcessingStatus('error');
      updateProcessingProgress({
        status: 'error',
        error: error instanceof Error ? error.message : '不明なエラーが発生しました'
      });
    } finally {
      processor.isProcessing = false;
    }
  }, [updateProcessingProgress, startRecording]);

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
        processVideo().catch(error => {
          console.error('動画処理エラー:', error);
          setProcessingStatus('error');
          updateProcessingProgress({
            status: 'error',
            error: error instanceof Error ? error.message : '不明なエラーが発生しました'
          });
        });
      }
    } catch (error) {
      console.error('動画アップロードエラー:', error);
      setProcessingStatus('error');
      updateProcessingProgress({
        status: 'error',
        error: '動画の準備中にエラーが発生しました'
      });
    }
  }, [isVideoAnalyzing, isRecording, stopVideoAnalysis, stopRecording, initHolistic, processVideo, updateProcessingProgress]);

  // 処理の停止
  const stopProcessing = useCallback(() => {
    const processor = frameProcessorRef.current;
    if (processor.isProcessing) {
      processor.shouldStop = true;
      setProcessingStatus('idle');
      updateProcessingProgress({
        status: 'idle',
        progress: 0
      });
    }
  }, [updateProcessingProgress]);

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
    } else if (analysisMode === 'video') {
      if (isVideoAnalyzing) {
        stopVideoAnalysis();
      }
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
  }, [analysisMode, isRecording, stopRecording, isVideoAnalyzing, stopVideoAnalysis]);

  // 現在のビューを録画してダウンロードする簡易機能
  const captureCurrentView = useCallback(() => {
    if (!canvasRef.current) {
      console.error('キャンバスが見つかりません');
      return;
    }
    
    console.log('現在のビュー録画開始');
    
    // 既存の録画をクリア
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    setRecordedChunks([]);
    setOutputVideoUrl(null);
    
    try {
      // キャンバスからストリームを取得する
      const stream = canvasRef.current.captureStream(30); // 30fpsで録画
      
      if (!stream || stream.getVideoTracks().length === 0) {
        console.error('ストリームまたはビデオトラックの取得に失敗');
        return;
      }
      
      console.log(`取得したストリーム: トラック数=${stream.getTracks().length}`);
      
      // コーデックの対応確認
      let options = {};
      const supportedTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          options = {
            mimeType: type,
            videoBitsPerSecond: 5000000
          };
          console.log(`${type}コーデック利用`);
          break;
        }
      }
      
      // MediaRecorderインスタンスの作成
      console.log('MediaRecorder作成', options);
      const mediaRecorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];
      
      // データ取得イベントハンドラ
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          console.log(`データチャンクサイズ: ${e.data.size} バイト`);
          chunks.push(e.data);
          setRecordedChunks(current => [...current, e.data]);
        }
      };
      
      // 録画停止イベントハンドラ
      mediaRecorder.onstop = () => {
        console.log(`録画終了、録画チャンク数: ${chunks.length}`);
        
        if (chunks.length === 0) {
          console.error('録画データがありません');
          return;
        }
        
        // Blobの作成
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        console.log(`Blob作成: MIMEタイプ=${mimeType}`);
        const blob = new Blob(chunks, { type: mimeType });
        
        console.log(`最終Blobサイズ: ${blob.size} バイト、タイプ: ${blob.type}`);
        
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          console.log('Blob URL作成:', url);
          setOutputVideoUrl(url);
          
          // 自動ダウンロード
          setTimeout(() => {
            downloadVideo();
          }, 500);
        } else {
          console.error('Blobのサイズが0です');
        }
      };
      
      // 録画開始
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); // 100msごとにデータを取得
      
      // 3秒間録画して自動停止
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          console.log('録画自動停止（3秒）');
          mediaRecorderRef.current.stop();
        }
      }, 3000);
      
    } catch (error) {
      console.error('録画の開始に失敗しました:', error);
    }
  }, [downloadVideo]);

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
            if (mediaRecorder.state !== 'inactive') {
              mediaRecorder.stop();
            }
          }
        } catch (e) {
          console.error('フレーム処理エラー:', e);
          requestAnimationFrame(processFrame);
        }
      };
      
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

  return (
    <div className="flex flex-col items-center w-full max-w-4xl mx-auto p-4">
      {/* タブ切り替え */}
      <div className="flex space-x-2 mb-4">
        <button
          onClick={() => switchMode('camera')}
          className={`px-4 py-2 rounded ${analysisMode === 'camera' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
        >
          カメラで分析
        </button>
        <button
          onClick={() => switchMode('video')}
          className={`px-4 py-2 rounded ${analysisMode === 'video' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
        >
          動画をアップロード
        </button>
      </div>
      
      {/* カメラモード */}
      {analysisMode === 'camera' && (
        <div className="flex flex-col items-center w-full">
          <div className="relative w-full aspect-video bg-black mb-4">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-contain opacity-0"
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-contain"
            />
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
                読み込み中...
              </div>
            )}
          </div>
          
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={initCamera}
              disabled={isLoading}
              className="px-4 py-2 bg-green-500 text-white rounded disabled:bg-gray-400"
            >
              カメラ接続
            </button>
            <button
              onClick={startRecording}
              disabled={!isInitialized || isRecording || isLoading}
              className="px-4 py-2 bg-red-500 text-white rounded disabled:bg-gray-400"
            >
              録画開始 {isInitialized ? '✓' : ''}
            </button>
            <button
              onClick={stopRecording}
              disabled={!isRecording}
              className="px-4 py-2 bg-gray-500 text-white rounded disabled:bg-gray-400"
            >
              録画停止
            </button>
            <button
              onClick={downloadVideo}
              disabled={!outputVideoUrl}
              className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
            >
              ダウンロード
            </button>
          </div>
          
          <div className="w-full p-4 bg-gray-100 rounded">
            <h3 className="font-bold mb-2">処理情報</h3>
            <p>処理フレーム数: {stats.framesProcessed}</p>
            <p>現在のFPS: {stats.fps}</p>
            <p>経過時間: {stats.elapsedTime}秒</p>
            <p>元の動画フレームレート: {originalFrameRate}</p>
            <p>カメラ準備完了: {isInitialized ? 'はい' : 'いいえ'}</p>
          </div>
        </div>
      )}
      
      {/* 動画アップロードモード */}
      {analysisMode === 'video' && (
        <div className="flex flex-col items-center w-full">
          <div className="relative w-full aspect-video bg-black mb-4">
            <video
              ref={uploadedVideoRef}
              className="absolute inset-0 w-full h-full object-contain"
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-contain z-10"
            />
            {!uploadedVideoUrl && (
              <div className="absolute inset-0 flex items-center justify-center bg-black text-white z-20">
                動画をアップロードしてください
              </div>
            )}
            {uploadedVideoUrl && !isVideoReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white z-20">
                <div className="flex flex-col items-center">
                  <Loader2 className="animate-spin mb-2" />
                  <span>動画を準備中...</span>
                </div>
              </div>
            )}
            {isVideoAnalyzing && (
              <div className="absolute top-0 left-0 right-0 flex items-center justify-between bg-blue-500 bg-opacity-90 text-white px-4 py-2 z-20">
                <div className="flex items-center">
                  <Loader2 className="animate-spin mr-2" />
                  <span>分析中... {stats.progress}%</span>
                </div>
                <div>
                  処理フレーム: {stats.framesProcessed}
                </div>
              </div>
            )}
            
            {/* 進行状況バー */}
            {isVideoAnalyzing && (
              <div className="absolute bottom-0 left-0 w-full h-2 bg-gray-700 z-20">
                <div 
                  className="h-full bg-green-500 transition-all duration-300" 
                  style={{ width: `${stats.progress}%` }}
                />
              </div>
            )}
          </div>
          
          {/* アップロードボタン群 */}
          <div className="flex flex-wrap gap-2 mb-4 justify-center">
            <label className={`
              px-4 py-2 rounded cursor-pointer
              ${isVideoAnalyzing ? 'bg-gray-500' : 'bg-green-500 hover:bg-green-600'}
              text-white transition-colors duration-200
            `}>
              {isVideoAnalyzing ? '処理中...' : '動画を選択（自動処理）'}
              <input
                type="file"
                accept="video/*"
                onChange={handleVideoUpload}
                className="hidden"
                disabled={isVideoAnalyzing}
              />
            </label>
            
            {/* ランドマーク付き動画を直接ダウンロード */}
            <div className="flex items-center gap-2">
              <button
                onClick={captureAndDownloadVideo}
                disabled={!isVideoReady}
                className={`
                  px-4 py-2 rounded 
                  ${!isVideoReady ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'} 
                  text-white transition-colors duration-200
                `}
              >
                ランドマーク付き動画をダウンロード
              </button>
              <span className="text-sm text-gray-600">
                ※動画の再生が1度完了してから押してください
              </span>
            </div>
          </div>
          
          {/* 処理状態の表示 */}
          {uploadedVideo && (
            <div className="w-full p-4 bg-gray-100 rounded mb-4">
              <h3 className="font-bold mb-2">アップロードされた動画</h3>
              <p>ファイル名: {uploadedVideo.name}</p>
              <p>サイズ: {Math.round(uploadedVideo.size / 1024 / 1024 * 100) / 100} MB</p>
              <p>状態: {
                isVideoAnalyzing ? '分析中' :
                isVideoReady ? '準備完了' :
                '読み込み中'
              }</p>
            </div>
          )}
          
          {/* 処理状況の詳細表示 */}
          {isVideoAnalyzing && (
            <div className="w-full p-4 bg-blue-100 rounded mb-4">
              <h3 className="font-bold mb-2 flex items-center">
                <div className="w-4 h-4 rounded-full bg-blue-500 animate-pulse mr-2" />
                処理状況
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <p>進行状況: {stats.progress}%</p>
                <p>処理フレーム: {stats.framesProcessed}</p>
                <p>現在のFPS: {stats.fps}</p>
                <p>経過時間: {stats.elapsedTime}秒</p>
                <p>推定残り時間: {stats.estimatedTimeRemaining}秒</p>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* 結果の動画を表示 */}
      {outputVideoUrl && (
        <div className="mt-4 w-full">
          <h3 className="font-bold mb-2">処理結果</h3>
          <video
            src={outputVideoUrl}
            className="w-full"
            controls
            autoPlay
          />
          <div className="mt-2 text-center">
            <button
              onClick={downloadVideo}
              className="px-4 py-2 bg-blue-500 text-white rounded"
            >
              この動画をダウンロード
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SimpleMotionAnalyzer; 