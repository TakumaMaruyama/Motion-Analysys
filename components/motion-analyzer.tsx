'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import Script from 'next/script';

// MediaPipe関連の型定義
declare global {
  interface Window {
    Pose: any;
    drawConnectors: any;
    drawLandmarks: any;
    POSE_CONNECTIONS: any;
  }
}

// ポーズ接続の定義（MediaPipeからロードされなかった場合のフォールバック）
const FALLBACK_POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  [17, 19], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]
];

export function MotionAnalyzer() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isScriptLoading, setIsScriptLoading] = useState(true);
  const [frameCount, setFrameCount] = useState(0);
  const [poseDetected, setPoseDetected] = useState(false);
  const [analysisStats, setAnalysisStats] = useState<{
    totalFrames: number;
    processedFrames: number;
    detectedPoses: number;
  }>({ totalFrames: 0, processedFrames: 0, detectedPoses: 0 });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pose = useRef<any>(null);
  
  // 直接Scriptタグを使ったMediaPipeスクリプトのロード
  const handleCameraUtilsLoad = () => {
    console.log('Camera utils loaded successfully');
  };
  
  const handleDrawingUtilsLoad = () => {
    console.log('Drawing utils loaded successfully');
  };
  
  const handlePoseLoad = () => {
    console.log('Pose loaded successfully');
    setIsScriptLoading(false);
    initPose();
  };
  
  // MediaPipe Poseの初期化
  const initPose = async () => {
    try {
      if (!window.Pose) {
        console.error('Pose not found in window object');
        setError('MediaPipe Poseオブジェクトが見つかりません。ブラウザのコンソールを確認してください。');
        return;
      }
      
      console.log('Initializing Pose...');
      pose.current = new window.Pose({
        locateFile: (file: string) => {
          // 特定のバージョンを指定（0.2.1638225873が安定していることが多い）
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.2.1638225873/${file}`;
        }
      });
      
      console.log('Setting options...');
      pose.current.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      
      console.log('Setting onResults handler...');
      pose.current.onResults(onResults);
      
      console.log('MediaPipe Pose initialized successfully');
      setIsModelLoaded(true);
    } catch (err) {
      console.error('Failed to initialize MediaPipe Pose:', err);
      setError('MediaPipe Poseの初期化に失敗しました: ' + (err instanceof Error ? err.message : String(err)));
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
    
    if (!videoRef.current || !canvasRef.current || !pose.current) {
      setError('内部コンポーネントの準備ができていません');
      return;
    }

    try {
      // 動画の準備
      setIsProcessing(true);
      setError(null);
      setProgress('動画を読み込み中...');
      setPoseDetected(false);
      setFrameCount(0);
      setAnalysisStats({ totalFrames: 0, processedFrames: 0, detectedPoses: 0 });
      
      const videoURL = URL.createObjectURL(file);
      videoRef.current.src = videoURL;
      
      // 動画のメタデータが読み込まれたとき
      videoRef.current.onloadedmetadata = () => {
        if (!videoRef.current || !canvasRef.current) return;
        
        // キャンバスのサイズを動画に合わせる
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        
        // フレーム数の計算 (推定)
        const estimatedFrames = Math.round(videoRef.current.duration * 30);
        setAnalysisStats(prev => ({ ...prev, totalFrames: estimatedFrames }));
        
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
    
    // フレームカウントの更新
    setFrameCount(prevCount => prevCount + 1);
    setAnalysisStats(prev => ({ 
      ...prev, 
      processedFrames: prev.processedFrames + 1 
    }));
    
    // ポーズのランドマークを描画
    const hasPose = results.poseLandmarks && results.poseLandmarks.length > 0;
    if (hasPose) {
      // ポーズが検出されたフラグを設定
      setPoseDetected(true);
      setAnalysisStats(prev => ({ 
        ...prev, 
        detectedPoses: prev.detectedPoses + 1 
      }));
      
      try {
        // 骨格の接続線を描画
        if (typeof window.drawConnectors === 'function') {
          const connections = window.POSE_CONNECTIONS || FALLBACK_POSE_CONNECTIONS;
          window.drawConnectors(canvasCtx, results.poseLandmarks, connections,
                         { color: '#00FF00', lineWidth: 3 });
        } else {
          console.error('drawConnectors is not a function:', typeof window.drawConnectors);
          // フォールバック: 手動で接続線を描画
          drawFallbackConnectors(canvasCtx, results.poseLandmarks, FALLBACK_POSE_CONNECTIONS);
        }
        
        if (typeof window.drawLandmarks === 'function') {
          window.drawLandmarks(canvasCtx, results.poseLandmarks,
                        { color: '#FF0000', lineWidth: 1, radius: 5 });
        } else {
          console.error('drawLandmarks is not a function:', typeof window.drawLandmarks);
          // フォールバック: 手動でランドマークを描画
          drawFallbackLandmarks(canvasCtx, results.poseLandmarks);
        }
      } catch (err) {
        console.error('Error drawing landmarks:', err);
      }
      
      // 姿勢の検出ステータステキストを表示
      canvasCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
      canvasCtx.fillRect(10, 10, 200, 60);
      canvasCtx.font = "16px Arial";
      canvasCtx.fillStyle = "white";
      canvasCtx.fillText("ポーズ検出: 成功", 20, 30);
      canvasCtx.fillText(`検出点数: ${results.poseLandmarks.length}`, 20, 55);
    } else {
      // 姿勢が検出されなかった場合のステータス表示
      canvasCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
      canvasCtx.fillRect(10, 10, 200, 30);
      canvasCtx.font = "16px Arial";
      canvasCtx.fillStyle = "yellow";
      canvasCtx.fillText("ポーズ検出: 検索中...", 20, 30);
    }
    
    // フレーム処理ステータスを表示
    canvasCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
    canvasCtx.fillRect(canvasRef.current.width - 210, 10, 200, 30);
    canvasCtx.font = "16px Arial";
    canvasCtx.fillStyle = "white";
    canvasCtx.fillText(`処理フレーム: ${frameCount}`, canvasRef.current.width - 200, 30);
    
    canvasCtx.restore();
  };
  
  // フォールバック: 手動でランドマークを描画
  const drawFallbackLandmarks = (ctx: CanvasRenderingContext2D, landmarks: any[]) => {
    if (!landmarks) return;
    
    landmarks.forEach(landmark => {
      ctx.beginPath();
      ctx.arc(
        landmark.x * ctx.canvas.width,
        landmark.y * ctx.canvas.height,
        5,
        0,
        2 * Math.PI
      );
      ctx.fillStyle = '#FF0000';
      ctx.fill();
    });
  };
  
  // フォールバック: 手動で接続線を描画
  const drawFallbackConnectors = (ctx: CanvasRenderingContext2D, landmarks: any[], connections: number[][]) => {
    if (!landmarks || !connections) return;
    
    connections.forEach(([start, end]) => {
      if (landmarks[start] && landmarks[end]) {
        ctx.beginPath();
        ctx.moveTo(
          landmarks[start].x * ctx.canvas.width,
          landmarks[start].y * ctx.canvas.height
        );
        ctx.lineTo(
          landmarks[end].x * ctx.canvas.width,
          landmarks[end].y * ctx.canvas.height
        );
        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    });
  };
  
  // 動画フレームの処理
  useEffect(() => {
    let rafId: number;
    
    const detectFrame = async () => {
      if (!videoRef.current || !canvasRef.current || !pose.current || 
          videoRef.current.paused || videoRef.current.ended) return;
      
      try {
        await pose.current.send({ image: videoRef.current });
      } catch (err) {
        console.error('Frame processing error:', err);
      }
      
      rafId = requestAnimationFrame(detectFrame);
    };
    
    if (isProcessing && videoRef.current && !videoRef.current.paused) {
      console.log('Starting frame detection...');
      detectFrame();
    }
    
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isProcessing]);
  
  // 分析完了時のステータス表示を最後のフレームに追加
  useEffect(() => {
    if (!isProcessing && frameCount > 0 && canvasRef.current) {
      const canvasCtx = canvasRef.current.getContext('2d');
      if (!canvasCtx) return;
      
      // 分析結果の概要を表示
      canvasCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
      canvasCtx.fillRect(10, canvasRef.current.height - 100, 280, 90);
      canvasCtx.font = "18px Arial";
      canvasCtx.fillStyle = "white";
      canvasCtx.fillText("分析完了", 20, canvasRef.current.height - 70);
      canvasCtx.fillText(`総フレーム数: ${frameCount}`, 20, canvasRef.current.height - 45);
      canvasCtx.fillText(`ポーズ検出率: ${Math.round(analysisStats.detectedPoses / Math.max(1, frameCount) * 100)}%`, 20, canvasRef.current.height - 20);
    }
  }, [isProcessing, frameCount, analysisStats]);
  
  // 再分析ボタンのハンドラ
  const handleReset = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    setIsProcessing(false);
    setError(null);
    setProgress('');
    setPoseDetected(false);
    setFrameCount(0);
  };

  return (
    <>
      {/* MediaPipeスクリプトをNext.jsのScriptコンポーネントでロード */}
      <Script
        src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1632432234/camera_utils.js"
        strategy="beforeInteractive"
        onLoad={handleCameraUtilsLoad}
      />
      <Script
        src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1632432234/drawing_utils.js"
        strategy="beforeInteractive"
        onLoad={handleDrawingUtilsLoad}
      />
      <Script
        src="https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.2.1638225873/pose.js"
        strategy="beforeInteractive"
        onLoad={handlePoseLoad}
      />
      
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {isScriptLoading || !isModelLoaded ? (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
                <p className="text-lg">MediaPipeモデルを読み込み中...</p>
                {error && (
                  <div className="text-center text-red-500 py-4">
                    <p>{error}</p>
                    <Button 
                      onClick={() => window.location.reload()} 
                      className="mt-4"
                      variant="outline"
                    >
                      ページを再読み込み
                    </Button>
                  </div>
                )}
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
              <div className="text-center py-2">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <p className="text-lg">{progress}</p>
                </div>
                <div className="bg-gray-200 h-2 rounded-full w-full mt-2 mb-4">
                  <div 
                    className="bg-green-500 h-2 rounded-full" 
                    style={{ 
                      width: `${Math.min(100, (analysisStats.processedFrames / Math.max(1, analysisStats.totalFrames)) * 100)}%` 
                    }}
                  ></div>
                </div>
                <div className="text-sm text-gray-500 flex justify-between">
                  <span>処理フレーム: {analysisStats.processedFrames}</span>
                  <span>ポーズ検出: {poseDetected ? '✅' : '🔍'}</span>
                  <span>検出率: {Math.round(analysisStats.detectedPoses / Math.max(1, analysisStats.processedFrames) * 100)}%</span>
                </div>
              </div>
            )}

            <div className="relative">
              <video 
                ref={videoRef} 
                className={isProcessing || (!isProcessing && frameCount > 0) ? "w-full h-auto" : "hidden"} 
                playsInline
                muted
              />
              <canvas 
                ref={canvasRef} 
                className={isProcessing || (!isProcessing && frameCount > 0) ? "absolute top-0 left-0 w-full h-auto" : "hidden"} 
              />
            </div>

            {error && !isScriptLoading && (
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

            {(isProcessing || (!isProcessing && frameCount > 0)) && (
              <div className="flex justify-center mt-4">
                <Button onClick={handleReset}>
                  別の動画を分析
                </Button>
              </div>
            )}
            
            {/* 分析完了後の結果表示 */}
            {!isProcessing && frameCount > 0 && (
              <div className="mt-4 p-4 border rounded-lg bg-gray-50">
                <h3 className="text-lg font-bold mb-2">分析結果</h3>
                <ul className="text-sm space-y-1">
                  <li>総フレーム数: {frameCount}</li>
                  <li>ポーズ検出フレーム数: {analysisStats.detectedPoses}</li>
                  <li>検出成功率: {Math.round(analysisStats.detectedPoses / Math.max(1, frameCount) * 100)}%</li>
                  <li>骨格ポイント: {poseDetected ? '検出成功' : '検出不十分'}</li>
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
