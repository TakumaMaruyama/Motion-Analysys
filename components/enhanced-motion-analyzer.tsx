'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import {
  Loader2, Download, Upload, Video, Play, Film,
  ZoomIn, ZoomOut, Settings, Info, Clock, RotateCcw, RefreshCw
} from 'lucide-react';
import { Holistic } from '@mediapipe/holistic';
import { Camera } from '@mediapipe/camera_utils';
import {
  drawLandmarks as mpDrawLandmarks,
  drawConnectors as mpDrawConnectors
} from '@mediapipe/drawing_utils';
import { POSE_CONNECTIONS, HAND_CONNECTIONS, FACEMESH_TESSELATION } from '@mediapipe/holistic';
import { useWorker } from '@/hooks/use-worker';
import { LandmarkData, ProcessedFrame, VideoProcessingConfig, ProcessingState } from '@/types/motion';
import { VideoEncoderService, VideoEncoderOptions } from '@/lib/video-encoder';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// デフォルトの処理設定
const DEFAULT_CONFIG: VideoProcessingConfig = {
  input: {
    width: 640,
    height: 480,
    frameRate: 30,
    sourceType: 'camera'
  },
  detection: {
    enabled: true,
    confidence: {
      minimum: 0.3,
      target: 0.7
    },
    smoothing: 0.5,
    skipFrames: 0
  },
  output: {
    width: 1280,
    height: 720,
    frameRate: 30,
    quality: 0.9,
    format: 'webm',
    codec: 'vp09.00.10.08'
  },
  performance: {
    useGPU: true,
    priorityMode: 'balanced',
    maxMemoryUsage: 2048,
    useWorkers: true
  }
};

// Camera オプションの型定義を拡張
interface CameraOptions {
  onFrame?: () => Promise<void>;
  width?: number;
  height?: number;
  facingMode?: string;
  frameRate?: number;
}

/**
 * 強化版モーション解析コンポーネント
 * WebWorkerを使用した並列処理とWebCodecs APIによる高品質動画生成を実装
 */
export default function EnhancedMotionAnalyzer() {
  // ビデオ・キャンバス要素への参照
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Holistic検出器とカメラインスタンス
  const holisticRef = useRef<Holistic | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  
  // 処理済みフレームの保存領域
  const processedFramesRef = useRef<ProcessedFrame[]>([]);
  
  // 処理設定
  const [config, setConfig] = useState<VideoProcessingConfig>(DEFAULT_CONFIG);
  
  // 処理状態
  const [processing, setProcessing] = useState<ProcessingState>({
    status: 'idle',
    progress: 0,
    stage: '',
    stats: {
      framesProcessed: 0,
      framesDropped: 0,
      averageFPS: 0,
      peakMemoryUsage: 0,
      processingTime: 0,
      currentMemoryUsage: 0
    }
  });
  
  // メディアリソース
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [outputVideo, setOutputVideo] = useState<string | null>(null);
  
  // フレーム処理用のWebWorker
  const frameProcessorWorker = useWorker<
    { type: string; frames?: ProcessedFrame[]; targetFPS?: number },
    { type: string; frames?: ProcessedFrame[]; progress?: number; stats?: any; error?: any }
  >('/workers/frame-processor.worker.js', {
    autoInitialize: true,
    onError: (err) => console.error('Frame processing error:', err)
  });
  
  // ランドマーク検出用のWebWorker
  const landmarkDetectorWorker = useWorker<
    { type: string; imageData?: ImageData; frameIndex?: number; timestamp?: number; config?: any },
    { type: string; landmarks?: LandmarkData; frameIndex?: number; timestamp?: number; processingTime?: number; error?: any }
  >('/workers/landmark-detection.worker.js', {
    autoInitialize: true,
    onError: (err) => console.error('Landmark detection error:', err)
  });
  
  // カメラの初期化
  const initCamera = useCallback(async () => {
    try {
      setProcessing(prev => ({
        ...prev,
        status: 'loading',
        stage: 'カメラの初期化中...'
      }));
      
      // 既存のストリームをクリーンアップ
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
      }
      
      // ユーザーのカメラにアクセス
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: config.input.width },
          height: { ideal: config.input.height },
          frameRate: { ideal: config.input.frameRate }
        },
        audio: false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setVideoStream(stream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        
        // キャンバスのサイズを設定
        if (canvasRef.current) {
          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
        }
        
        // Holisticの初期化
        await initHolistic();
        
        // カメラとの接続を設定
        if (holisticRef.current && !cameraRef.current) {
          const videoElement = videoRef.current;
          if (videoElement) {
            // フレームレートを直接videoElementに設定
            videoElement.defaultPlaybackRate = config.input.frameRate / 30; // 30fpsを基準に調整
            
            const cameraOptions: CameraOptions = {
              onFrame: async () => {
                if (holisticRef.current && videoRef.current) {
                  await holisticRef.current.send({ image: videoRef.current });
                }
              },
              width: videoElement.videoWidth,
              height: videoElement.videoHeight
            };
            
            cameraRef.current = new Camera(videoElement, cameraOptions);
            
            // カメラ開始
            await cameraRef.current.start();
          }
        }
        
        setProcessing(prev => ({
          ...prev,
          status: 'idle',
          stage: ''
        }));
      }
    } catch (error) {
      console.error('Failed to initialize camera:', error);
      setProcessing(prev => ({
        ...prev,
        status: 'error',
        error: {
          code: 'CAMERA_ERROR',
          message: 'カメラの初期化に失敗しました',
          details: error
        }
      }));
    }
  }, [config.input.width, config.input.height, config.input.frameRate, videoStream]);
  
  // Holistic検出器の初期化
  const initHolistic = useCallback(async () => {
    // 既存のインスタンスをクリーンアップ
    if (holisticRef.current) {
      holisticRef.current.close();
    }
    
    // 新しいインスタンスを作成
    holisticRef.current = new Holistic({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`;
      }
    });
    
    // 設定を適用
    holisticRef.current.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      refineFaceLandmarks: true,
      minDetectionConfidence: config.detection.confidence.minimum,
      minTrackingConfidence: config.detection.confidence.target
    });
    
    // 結果処理コールバックを設定
    holisticRef.current.onResults(handleHolisticResults);
  }, [config.detection.confidence.minimum, config.detection.confidence.target]);
  
  // Holisticの結果を処理
  const handleHolisticResults = useCallback((results: any) => {
    if (!canvasRef.current || !results) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const startTime = performance.now();
    
    // キャンバスをクリア
    ctx.save();
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    // 入力画像を描画
    ctx.drawImage(
      results.image, 0, 0, canvasRef.current.width, canvasRef.current.height
    );
    
    // ランドマークを描画
    if (results.poseLandmarks) {
      mpDrawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
        color: '#00FF00',
        lineWidth: 2
      });
      mpDrawLandmarks(ctx, results.poseLandmarks, {
        color: '#FF0000',
        lineWidth: 1,
        radius: 3
      });
    }
    
    if (results.faceLandmarks) {
      mpDrawConnectors(ctx, results.faceLandmarks, FACEMESH_TESSELATION, {
        color: '#C0C0C070',
        lineWidth: 1
      });
    }
    
    if (results.leftHandLandmarks) {
      mpDrawConnectors(ctx, results.leftHandLandmarks, HAND_CONNECTIONS, {
        color: '#CC0000',
        lineWidth: 2
      });
      mpDrawLandmarks(ctx, results.leftHandLandmarks, {
        color: '#00FF00',
        lineWidth: 1,
        radius: 2
      });
    }
    
    if (results.rightHandLandmarks) {
      mpDrawConnectors(ctx, results.rightHandLandmarks, HAND_CONNECTIONS, {
        color: '#00CC00',
        lineWidth: 2
      });
      mpDrawLandmarks(ctx, results.rightHandLandmarks, {
        color: '#FF0000',
        lineWidth: 1,
        radius: 2
      });
    }
    
    ctx.restore();
    
    // フレーム情報を保存
    try {
      if (processing.status === 'processing') {
        const imageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
        const timestamp = videoRef.current?.currentTime || performance.now();
        const frameIndex = processedFramesRef.current.length;
        
        // メモリ使用量を考慮して上限を設定
        const memoryLimit = config.performance.maxMemoryUsage * 1024 * 1024; // MBをバイトに変換
        
        // メモリ使用量の概算（ImageDataの1ピクセルは4バイト）
        const currentMemoryUsage = processedFramesRef.current.reduce(
          (sum, frame) => sum + (frame.imageData.data.length || 0), 0
        );
        
        const frameSize = imageData.data.length;
        const estimatedNewMemory = currentMemoryUsage + frameSize;
        
        // メモリが上限を超えそうな場合は古いフレームを削除
        if (estimatedNewMemory > memoryLimit && processedFramesRef.current.length > 0) {
          processedFramesRef.current.shift();
        }
        
        // 高精度タイムスタンプを使用
        const processingTime = performance.now() - startTime;
        
        // フレームを保存
        processedFramesRef.current.push({
          imageData,
          timestamp,
          sourceTime: timestamp,
          index: frameIndex,
          metadata: {
            processingTime,
            captureTime: performance.now(),
            quality: 1.0
          }
        });
        
        // 統計情報を更新
        setProcessing(prev => ({
          ...prev,
          stats: {
            ...prev.stats,
            framesProcessed: processedFramesRef.current.length,
            currentMemoryUsage: estimatedNewMemory,
            peakMemoryUsage: Math.max(prev.stats.peakMemoryUsage, estimatedNewMemory),
            averageFPS: prev.stats.processingTime > 0 
              ? prev.stats.framesProcessed / (prev.stats.processingTime / 1000)
              : 0,
            processingTime: prev.stats.processingTime + processingTime
          }
        }));
      }
    } catch (error) {
      console.error('フレーム保存エラー:', error);
    }
  }, [processing.status, config.performance.maxMemoryUsage]);
  
  // ランドマーク検出処理の開始
  const startProcessing = useCallback(async () => {
    // 既存のフレームをクリア
    processedFramesRef.current = [];
    
    setProcessing(prev => ({
      ...prev,
      status: 'processing',
      progress: 0,
      stage: '動画キャプチャ中...',
      stats: {
        framesProcessed: 0,
        framesDropped: 0,
        averageFPS: 0,
        peakMemoryUsage: 0,
        processingTime: 0,
        currentMemoryUsage: 0
      }
    }));
    
    // ワーカーを初期化
    if (config.performance.useWorkers) {
      try {
        await landmarkDetectorWorker.sendMessage({
          type: 'init',
          config: {
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: config.detection.confidence.minimum,
            minTrackingConfidence: config.detection.confidence.target,
            refineFaceLandmarks: true
          }
        });
      } catch (error) {
        console.error('Failed to initialize landmark detector worker:', error);
      }
    }
  }, [config.detection.confidence.minimum, config.detection.confidence.target, config.performance.useWorkers, landmarkDetectorWorker]);
  
  // 処理の停止
  const stopProcessing = useCallback(() => {
    setProcessing(prev => ({
      ...prev,
      status: 'idle',
      stage: '',
      progress: 0
    }));
  }, []);
  
  // 動画生成処理
  const generateVideo = useCallback(async () => {
    if (processedFramesRef.current.length === 0) {
      alert('処理済みのフレームがありません');
      return;
    }
    
    try {
      setProcessing(prev => ({
        ...prev,
        status: 'rendering',
        progress: 0,
        stage: 'フレーム補間中...'
      }));
      
      // フレーム補間処理（WebWorkerで実行）
      let frames = processedFramesRef.current;
      
      if (config.performance.useWorkers) {
        try {
          const interpolationResult = await frameProcessorWorker.sendMessage({
            type: 'interpolate',
            frames: processedFramesRef.current,
            targetFPS: config.output.frameRate
          });
          
          if (interpolationResult.frames) {
            frames = interpolationResult.frames;
          }
          
          setProcessing(prev => ({
            ...prev,
            stage: '動画エンコード中...',
            progress: 0.3
          }));
        } catch (error) {
          console.error('Failed to interpolate frames:', error);
        }
      }
      
      // 動画エンコード設定
      const encoderOptions: VideoEncoderOptions = {
        width: config.output.width,
        height: config.output.height,
        frameRate: config.output.frameRate,
        bitrate: 5_000_000 * config.output.quality, // 5Mbps * quality
        codec: config.output.codec,
        hardwareAcceleration: config.performance.useGPU ? 'prefer-hardware' : 'prefer-software',
        latencyMode: 'quality'
      };
      
      // 進捗コールバック
      const handleProgress = (progress: number, stats?: any) => {
        setProcessing(prev => ({
          ...prev,
          progress: 0.3 + (progress * 0.7), // 30%は補間で済んでいるので70%をエンコードに割り当て
          stats: {
            ...prev.stats,
            ...stats
          }
        }));
      };
      
      // 動画エンコード（WebCodecs API使用）
      const videoBlob = await VideoEncoderService.encodeFramesToVideo(
        frames,
        encoderOptions,
        handleProgress
      );
      
      // 生成した動画のURLを作成
      const videoUrl = URL.createObjectURL(videoBlob);
      setOutputVideo(videoUrl);
      
      setProcessing(prev => ({
        ...prev,
        status: 'completed',
        progress: 1,
        stage: '動画生成完了'
      }));
    } catch (error) {
      console.error('動画生成エラー:', error);
      setProcessing(prev => ({
        ...prev,
        status: 'error',
        error: {
          code: 'ENCODING_ERROR',
          message: '動画のエンコードに失敗しました',
          details: error
        }
      }));
    }
  }, [config.output.width, config.output.height, config.output.frameRate, config.output.quality, config.output.codec, config.performance.useGPU, config.performance.useWorkers, frameProcessorWorker]);
  
  // 動画のダウンロード
  const downloadVideo = useCallback(() => {
    if (outputVideo) {
      const a = document.createElement('a');
      a.href = outputVideo;
      a.download = `motion-analysis-${Date.now()}.webm`;
      a.click();
    }
  }, [outputVideo]);
  
  // コンポーネントのクリーンアップ処理
  useEffect(() => {
    return () => {
      // ストリームをクリーンアップ
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
      }
      
      // Holisticインスタンスをクリーンアップ
      if (holisticRef.current) {
        holisticRef.current.close();
      }
      
      // カメラをクリーンアップ
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      
      // WorkerManagerをクリーンアップ
      frameProcessorWorker.terminate();
      landmarkDetectorWorker.terminate();
      
      // URL解放
      if (outputVideo) {
        URL.revokeObjectURL(outputVideo);
      }
    };
  }, [videoStream, outputVideo, frameProcessorWorker, landmarkDetectorWorker]);
  
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">強化版モーション解析</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="overflow-hidden">
          <CardContent className="p-2">
            <div className="relative">
              <video
                ref={videoRef}
                className="w-full h-auto"
                playsInline
                muted
                style={{ display: 'none' }}
              />
              <canvas
                ref={canvasRef}
                className="w-full h-auto border border-gray-300"
              />
              {processing.status === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
                  <Loader2 className="animate-spin text-white" size={48} />
                  <span className="text-white ml-2">{processing.stage}</span>
                </div>
              )}
            </div>
            
            <div className="flex gap-2 mt-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={initCamera}
                      disabled={processing.status === 'loading' || processing.status === 'processing'}
                      variant="outline"
                    >
                      <Video size={16} className="mr-1" />
                      カメラ接続
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>カメラに接続して動作分析を開始</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={startProcessing}
                      disabled={!videoStream || processing.status === 'loading' || processing.status === 'processing'}
                      variant={processing.status === 'processing' ? 'default' : 'outline'}
                    >
                      {processing.status === 'processing' ? (
                        <>
                          <Loader2 size={16} className="animate-spin mr-1" />
                          録画中...
                        </>
                      ) : (
                        <>
                          <Play size={16} className="mr-1" />
                          録画開始
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>フレームキャプチャとランドマーク検出を開始</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={stopProcessing}
                      disabled={processing.status !== 'processing'}
                      variant="outline"
                    >
                      <span className="mr-1">⏹</span>
                      停止
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>録画を停止</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-2">
            <div className="relative">
              <canvas
                ref={outputCanvasRef}
                className="w-full h-auto border border-gray-300"
              />
              {(processing.status === 'rendering' || outputVideo) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  {processing.status === 'rendering' ? (
                    <div className="bg-black bg-opacity-50 p-4 rounded w-full text-center">
                      <Loader2 className="animate-spin text-white mx-auto" size={48} />
                      <span className="text-white block mt-2">{processing.stage}</span>
                      <Progress value={processing.progress * 100} className="mt-2" />
                      <span className="text-white text-sm">
                        {Math.round(processing.progress * 100)}%
                      </span>
                    </div>
                  ) : outputVideo ? (
                    <video
                      src={outputVideo}
                      controls
                      className="w-full h-full"
                    />
                  ) : null}
                </div>
              )}
            </div>
            
            <div className="flex gap-2 mt-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={generateVideo}
                      disabled={processedFramesRef.current.length === 0 || processing.status === 'rendering' || processing.status === 'loading'}
                      variant="outline"
                    >
                      <Film size={16} className="mr-1" />
                      動画生成
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>キャプチャしたフレームから動画を生成</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={downloadVideo}
                      disabled={!outputVideo}
                      variant="outline"
                    >
                      <Download size={16} className="mr-1" />
                      ダウンロード
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>生成した動画をダウンロード</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* 統計情報表示 */}
      <Card className="mt-4">
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-2 flex items-center">
            <Info size={18} className="mr-1" />
            処理統計
          </h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-100 p-2 rounded">
              <div className="text-sm text-gray-500">フレーム数</div>
              <div className="text-lg font-medium">{processing.stats.framesProcessed}</div>
            </div>
            
            <div className="bg-gray-100 p-2 rounded">
              <div className="text-sm text-gray-500">平均FPS</div>
              <div className="text-lg font-medium">
                {processing.stats.averageFPS.toFixed(1)}
              </div>
            </div>
            
            <div className="bg-gray-100 p-2 rounded">
              <div className="text-sm text-gray-500">メモリ使用量</div>
              <div className="text-lg font-medium">
                {(processing.stats.currentMemoryUsage / (1024 * 1024)).toFixed(1)} MB
              </div>
            </div>
            
            <div className="bg-gray-100 p-2 rounded">
              <div className="text-sm text-gray-500">処理時間</div>
              <div className="text-lg font-medium">
                {(processing.stats.processingTime / 1000).toFixed(1)} 秒
              </div>
            </div>
          </div>
          
          {processing.status === 'error' && (
            <div className="bg-red-50 border border-red-200 p-3 mt-4 rounded text-red-700">
              <h3 className="font-medium">エラーが発生しました</h3>
              <p>{processing.error?.message}</p>
              <p className="text-sm mt-1">{processing.error?.code}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 