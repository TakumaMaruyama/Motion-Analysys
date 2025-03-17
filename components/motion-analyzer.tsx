'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Upload } from 'lucide-react';

export function MotionAnalyzer() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [processedVideoUrl, setProcessedVideoUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 動画ファイルが選択されたときの処理
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type.startsWith('video/')) {
        setVideoFile(file);
        setError(null);
        
        // 動画のURLを作成
        const url = URL.createObjectURL(file);
        setVideoUrl(url);
        setProcessedVideoUrl(null); // 新しい動画がアップロードされたら処理済み動画をリセット
      } else {
        setError('動画ファイルを選択してください');
        setVideoFile(null);
        setVideoUrl(null);
      }
    }
  };

  // 動画アップロードボタンのクリックハンドラ
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // 動画分析処理
  const processVideo = async () => {
    if (!videoFile || !videoRef.current || !canvasRef.current) return;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      // MediaPipe Poseモジュールの読み込み
      const { Pose } = await import('@mediapipe/pose');
      const { Camera } = await import('@mediapipe/camera_utils');
      
      // キャンバスの設定
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');
      
      // 動画のメタデータが読み込まれたら
      videoRef.current.onloadedmetadata = () => {
        const videoWidth = videoRef.current!.videoWidth;
        const videoHeight = videoRef.current!.videoHeight;
        
        // キャンバスのサイズを動画に合わせる
        canvasRef.current!.width = videoWidth;
        canvasRef.current!.height = videoHeight;
        
        // Poseインスタンスの作成
        const pose = new Pose({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
          }
        });
        
        // Poseの設定
        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          smoothSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        
        // 結果の処理
        pose.onResults((results) => {
          // キャンバスをクリア
          ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
          
          // 動画フレームを描画
          ctx.drawImage(
            results.image, 0, 0, canvasRef.current!.width, canvasRef.current!.height
          );
          
          // ポーズのランドマークを描画
          if (results.poseLandmarks) {
            drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
              color: '#00FF00',
              lineWidth: 4
            });
            drawLandmarks(ctx, results.poseLandmarks, {
              color: '#FF0000',
              lineWidth: 2,
              radius: 4
            });
          }
        });
        
        // カメラユーティリティの設定
        const camera = new Camera(videoRef.current!, {
          onFrame: async () => {
            await pose.send({ image: videoRef.current! });
          },
          width: videoWidth,
          height: videoHeight
        });
        
        // 処理開始
        camera.start();
        
        // 動画の再生
        videoRef.current!.play();
      };
      
      // 動画の再生終了時の処理
      videoRef.current.onended = () => {
        // キャンバスから処理済み動画を生成
        canvasRef.current!.toBlob((blob) => {
          if (blob) {
            const processedUrl = URL.createObjectURL(blob);
            setProcessedVideoUrl(processedUrl);
          }
          setIsProcessing(false);
        }, 'image/png');
      };
      
      // 動画の読み込みエラー時の処理
      videoRef.current.onerror = () => {
        setError('動画の読み込み中にエラーが発生しました');
        setIsProcessing(false);
      };
      
    } catch (err) {
      console.error('Video processing error:', err);
      setError('動画の処理中にエラーが発生しました');
      setIsProcessing(false);
    }
  };

  // ヘルパー関数: ランドマーク間の接続線を描画
  const drawConnectors = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    connections: number[][],
    options: { color: string; lineWidth: number }
  ) => {
    const { color, lineWidth } = options;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    
    for (const connection of connections) {
      const [start, end] = connection;
      if (landmarks[start] && landmarks[end]) {
        const startX = landmarks[start].x * ctx.canvas.width;
        const startY = landmarks[start].y * ctx.canvas.height;
        const endX = landmarks[end].x * ctx.canvas.width;
        const endY = landmarks[end].y * ctx.canvas.height;
        
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    }
  };

  // ヘルパー関数: ランドマークを描画
  const drawLandmarks = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    options: { color: string; lineWidth: number; radius: number }
  ) => {
    const { color, lineWidth, radius } = options;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    
    for (const landmark of landmarks) {
      const x = landmark.x * ctx.canvas.width;
      const y = landmark.y * ctx.canvas.height;
      
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  };

  // ポーズの接続定義
  const POSE_CONNECTIONS = [
    // 顔
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
    // 上半身
    [9, 10], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    // 下半身
    [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32]
  ];

  // 分析ボタンのクリックハンドラ
  const handleAnalyzeClick = () => {
    processVideo();
  };

  // コンポーネントのクリーンアップ
  useEffect(() => {
    return () => {
      // URLオブジェクトの解放
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (processedVideoUrl) URL.revokeObjectURL(processedVideoUrl);
    };
  }, [videoUrl, processedVideoUrl]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFileChange}
                ref={fileInputRef}
              />
              
              <Upload className="h-12 w-12 text-gray-400 mb-4" />
              <div className="space-y-2">
                <h3 className="text-lg font-medium">動画をアップロード</h3>
                <p className="text-sm text-gray-500">
                  MP4, MOV, WEBMなどの動画ファイルをドラッグ＆ドロップまたは選択してください
                </p>
              </div>
              
              <Button
                onClick={handleUploadClick}
                className="mt-4"
                variant="outline"
              >
                動画を選択
              </Button>
            </div>

            {error && (
              <div className="bg-red-50 text-red-500 p-3 rounded-md text-center">
                {error}
              </div>
            )}

            {videoUrl && (
              <div className="space-y-4">
                <Label className="block text-lg font-medium">アップロードされた動画</Label>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="w-full rounded-lg"
                  controls
                />
                
                <Button
                  onClick={handleAnalyzeClick}
                  className="w-full"
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    '動作を分析する'
                  )}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 処理用キャンバス (非表示) */}
      <canvas ref={canvasRef} className="hidden" />

      {/* 分析結果 */}
      {processedVideoUrl && (
        <Card>
          <CardContent className="p-6">
            <Label className="block text-lg font-medium mb-4">分析結果</Label>
            <video
              src={processedVideoUrl}
              className="w-full rounded-lg"
              controls
            />
            <div className="mt-4 text-sm text-gray-500">
              <p>ランドマークの説明:</p>
              <ul className="list-disc pl-5 mt-2">
                <li><span className="inline-block w-3 h-3 bg-red-500 rounded-full mr-2"></span> 関節ポイント</li>
                <li><span className="inline-block w-4 h-1 bg-green-500 mr-2"></span> 骨格接続</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
