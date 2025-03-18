'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import Script from 'next/script';

// MediaPipe関連の型定義
declare global {
  interface Window {
    Holistic: any;
    drawConnectors: any;
    drawLandmarks: any;
    POSE_CONNECTIONS: any;
  }
}

export function MotionAnalyzer() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isScriptsLoaded, setIsScriptsLoaded] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holistic = useRef<any>(null);
  
  // スクリプトの読み込み状態を管理
  useEffect(() => {
    if (isScriptsLoaded && window.Holistic) {
      setIsModelLoaded(true);
      initHolistic();
    }
  }, [isScriptsLoaded]);
  
  // MediaPipe Holisticの初期化
  const initHolistic = async () => {
    try {
      holistic.current = new window.Holistic({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675469404/${file}`;
        }
      });
      
      holistic.current.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      
      holistic.current.onResults(onResults);
      
      console.log('MediaPipe Holistic initialized');
    } catch (err) {
      console.error('Failed to initialize MediaPipe Holistic:', err);
      setError('MediaPipe Holisticの初期化に失敗しました');
    }
  };
  
  // 動画ファイルが選択されたときの処理
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setError('動画ファイルを選択してください');
      return;
    }
    
    if (!videoRef.current || !canvasRef.current || !holistic.current) {
      setError('内部コンポーネントの準備ができていません');
      return;
    }

    try {
      // 動画の準備
      setIsProcessing(true);
      setError(null);
      setProgress('動画を読み込み中...');
      
      const videoURL = URL.createObjectURL(file);
      videoRef.current.src = videoURL;
      
      // 動画のメタデータが読み込まれたとき
      videoRef.current.onloadedmetadata = () => {
        if (!videoRef.current || !canvasRef.current) return;
        
        // キャンバスのサイズを動画に合わせる
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        
        setProgress('動画を分析中...');
        
        // 動画を再生して分析開始
        videoRef.current.play();
      };
      
      // 動画の再生エラー
      videoRef.current.onerror = () => {
        setError('動画の読み込みに失敗しました');
        setIsProcessing(false);
      };
      
      // 動画の再生完了
      videoRef.current.onended = () => {
        setIsProcessing(false);
        setProgress('分析完了');
      };
      
    } catch (err: any) {
      console.error('Video processing error:', err);
      setError(`動画の処理中にエラーが発生しました: ${err.message || 'Unknown error'}`);
      setIsProcessing(false);
    }
  };
  
  // 分析結果の処理
  const onResults = (results: any) => {
    if (!canvasRef.current) return;
    
    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) return;
    
    // キャンバスをクリア
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    // 動画フレームを描画
    canvasCtx.drawImage(
      results.image, 0, 0, canvasRef.current.width, canvasRef.current.height
    );
    
    // ポーズのランドマークを描画
    if (results.poseLandmarks) {
      // ポーズのランドマークを描画
      window.drawConnectors(canvasCtx, results.poseLandmarks, window.POSE_CONNECTIONS,
                     { color: '#00FF00', lineWidth: 3 });
      window.drawLandmarks(canvasCtx, results.poseLandmarks,
                    { color: '#FF0000', lineWidth: 1, radius: 5 });
    }
    
    canvasCtx.restore();
  };
  
  // 動画フレームの処理
  useEffect(() => {
    let rafId: number;
    
    const detectFrame = async () => {
      if (!videoRef.current || !canvasRef.current || !holistic.current || 
          videoRef.current.paused || videoRef.current.ended) return;
      
      try {
        await holistic.current.send({ image: videoRef.current });
      } catch (err) {
        console.error('Frame processing error:', err);
      }
      
      rafId = requestAnimationFrame(detectFrame);
    };
    
    if (isProcessing && videoRef.current && !videoRef.current.paused) {
      detectFrame();
    }
    
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isProcessing]);
  
  // 再分析ボタンのハンドラ
  const handleReset = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    setIsProcessing(false);
    setError(null);
    setProgress('');
  };

  return (
    <>
      {/* MediaPipe スクリプトの読み込み */}
      <Script 
        src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" 
        onLoad={() => console.log('Camera utils loaded')}
      />
      <Script 
        src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js" 
        onLoad={() => console.log('Drawing utils loaded')}
      />
      <Script 
        src="https://cdn.jsdelivr.net/npm/@mediapipe/holistic/holistic.js" 
        onLoad={() => setIsScriptsLoaded(true)}
      />
      
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {!isModelLoaded ? (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
                <p className="text-lg">MediaPipeモデルを読み込み中...</p>
              </div>
            ) : !isProcessing && !error ? (
              <>
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleFileChange}
                  ref={fileInputRef}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-32 text-lg"
                  variant="outline"
                >
                  クリックして動画をアップロード
                </Button>
              </>
            ) : null}

            {isProcessing && (
              <div className="text-center py-4">
                <p className="text-lg mb-4">{progress}</p>
              </div>
            )}

            <div className="relative">
              <video 
                ref={videoRef} 
                className={isProcessing ? "w-full h-auto" : "hidden"} 
                playsInline
                muted
              />
              <canvas 
                ref={canvasRef} 
                className={isProcessing ? "absolute top-0 left-0 w-full h-auto" : "hidden"} 
              />
            </div>

            {error && (
              <div className="text-center text-red-500 py-4">
                <p>{error}</p>
                <Button 
                  onClick={() => setError(null)} 
                  className="mt-4"
                  variant="outline"
                >
                  再試行
                </Button>
              </div>
            )}

            {isProcessing && (
              <div className="flex justify-center mt-4">
                <Button onClick={handleReset}>
                  別の動画を分析
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
