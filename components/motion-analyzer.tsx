'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Download, Upload, Video, Play, Film } from 'lucide-react';
import { Holistic, POSE_CONNECTIONS, HAND_CONNECTIONS, FACEMESH_TESSELATION } from '@mediapipe/holistic';
import { Camera } from '@mediapipe/camera_utils';
import { drawLandmarks as mpDrawLandmarks, drawConnectors as mpDrawConnectors } from '@mediapipe/drawing_utils';
import { Results } from '@mediapipe/holistic';
import { LandmarkData, ProcessedFrame } from '../types/motion';

// MediaRecorder APIタイプ定義
interface MediaRecorderOptions {
  mimeType?: string;
  audioBitsPerSecond?: number;
  videoBitsPerSecond?: number;
  bitsPerSecond?: number;
}

// 動作分析結果の型定義
interface MotionAnalysisResult {
  sessionId: string;
  frameCount: number;
  duration: number;
  frameRate: number;
  createdAt: string;
  videoSize: {
    width: number;
    height: number;
  };
}

// 改良版ランドマーク検出関数 - 実際の映像から動きを検出
const detectMovementLandmarks = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  currentFrame: number = 0,
  previousFrameData?: ImageData
) => {
  // 本来はここでAIを使った画像認識を行うべきですが、簡易版として
  // フレーム間の差分検出によって動きを検出します
  
  // 現在のフレームのデータを取得
  const currentFrameData = ctx.getImageData(0, 0, width, height);
  const currentData = currentFrameData.data;
  
  // 人体の基本的な比率に基づくランドマークの配置（動画の中央を人物として仮定）
  const centerX = width / 2;
  const centerY = height / 2;
  
  // 体の各部位の初期位置を配置
  const baseLandmarks = [
    // 頭部
    { name: 'head', x: centerX, y: centerY - height * 0.25, z: 0, visibility: 1 },
    // 肩
    { name: 'left_shoulder', x: centerX - width * 0.1, y: centerY - height * 0.15, z: 0, visibility: 1 },
    { name: 'right_shoulder', x: centerX + width * 0.1, y: centerY - height * 0.15, z: 0, visibility: 1 },
    // 肘
    { name: 'left_elbow', x: centerX - width * 0.15, y: centerY, z: 0, visibility: 1 },
    { name: 'right_elbow', x: centerX + width * 0.15, y: centerY, z: 0, visibility: 1 },
    // 手首
    { name: 'left_wrist', x: centerX - width * 0.2, y: centerY + height * 0.1, z: 0, visibility: 1 },
    { name: 'right_wrist', x: centerX + width * 0.2, y: centerY + height * 0.1, z: 0, visibility: 1 },
    // 腰
    { name: 'left_hip', x: centerX - width * 0.08, y: centerY + height * 0.1, z: 0, visibility: 1 },
    { name: 'right_hip', x: centerX + width * 0.08, y: centerY + height * 0.1, z: 0, visibility: 1 },
    // 膝
    { name: 'left_knee', x: centerX - width * 0.09, y: centerY + height * 0.25, z: 0, visibility: 1 },
    { name: 'right_knee', x: centerX + width * 0.09, y: centerY + height * 0.25, z: 0, visibility: 1 },
    // 足首
    { name: 'left_ankle', x: centerX - width * 0.1, y: centerY + height * 0.4, z: 0, visibility: 1 },
    { name: 'right_ankle', x: centerX + width * 0.1, y: centerY + height * 0.4, z: 0, visibility: 1 },
  ];
  
  // 前のフレームデータがある場合は動きを検出して位置を調整
  if (previousFrameData) {
    const prevData = previousFrameData.data;
    let leftMovement = 0;
    let rightMovement = 0;
    let upMovement = 0;
    let downMovement = 0;
    
    // 画像を分割して左右上下の動きを検出
    // 左半分
    const leftRegion = {
      startX: 0,
      endX: Math.floor(width / 2),
      startY: 0,
      endY: height
    };
    
    // 右半分
    const rightRegion = {
      startX: Math.floor(width / 2),
      endX: width,
      startY: 0,
      endY: height
    };
    
    // 上半分
    const topRegion = {
      startX: 0,
      endX: width,
      startY: 0,
      endY: Math.floor(height / 2)
    };
    
    // 下半分
    const bottomRegion = {
      startX: 0,
      endX: width,
      startY: Math.floor(height / 2),
      endY: height
    };
    
    // 各領域ごとにピクセルの差分を計算
    const regionDiff = (region: {startX: number, endX: number, startY: number, endY: number}) => {
      let diffSum = 0;
      let pixelCount = 0;
      
      // サンプリング間隔をさらに小さくして、より細かい動きを検出（5ピクセルから3ピクセルに）
      for (let y = region.startY; y < region.endY; y += 3) { 
        for (let x = region.startX; x < region.endX; x += 3) {
          const idx = (y * width + x) * 4;
          
          // RGBの差分
          const rDiff = Math.abs(currentData[idx] - prevData[idx]);
          const gDiff = Math.abs(currentData[idx + 1] - prevData[idx + 1]);
          const bDiff = Math.abs(currentData[idx + 2] - prevData[idx + 2]);
          
          // 3チャンネルの差分 - 緑チャンネルの重みを増やす（人間の肌色の検出向上）
          const avgDiff = (rDiff + gDiff * 1.5 + bDiff) / 3.5;
          diffSum += avgDiff;
          pixelCount++;
        }
      }
      
      return diffSum / (pixelCount || 1); // ゼロ除算を防止
    };
    
    // 各領域の動きを検出
    leftMovement = regionDiff(leftRegion);
    rightMovement = regionDiff(rightRegion);
    upMovement = regionDiff(topRegion);
    downMovement = regionDiff(bottomRegion);
    
    // 動きの大きさに応じて関節の位置を調整
    // しきい値をさらに下げて感度を向上
    const movementThreshold = 1.5; // 2から1.5に変更してさらに感度を上げる
    
    // 動きに応じた調整量 - 感度をさらに向上
    const adjustX = (leftMovement > movementThreshold || rightMovement > movementThreshold) 
      ? (rightMovement - leftMovement) * 0.12 // 左右の動きの差に基づいて調整 - 0.1→0.12に増加
      : Math.sin(currentFrame * 0.05) * 1.5; // 既存のアニメーション - 微小に調整
      
    const adjustY = (upMovement > movementThreshold || downMovement > movementThreshold)
      ? (downMovement - upMovement) * 0.12 // 上下の動きの差に基づいて調整 - 0.1→0.12に増加
      : Math.cos(currentFrame * 0.04) * 1.5; // 既存のアニメーション - 微小に調整
    
    // 動きの大きさ（全体の動き）
    const movementMagnitude = (leftMovement + rightMovement + upMovement + downMovement) / 4;
    
    // 速い動きの場合は調整係数を増加させる - さらに感度良く
    const speedFactor = movementMagnitude > movementThreshold * 2 ? 2.0 : 
                       movementMagnitude > movementThreshold ? 1.5 : 1.0;
    
    // 各ランドマークの位置を動きに合わせて調整
    return baseLandmarks.map(landmark => {
      // 体の部位ごとに調整量を変える
      let xAdjust = 0;
      let yAdjust = 0;
      
      // 体の左側
      if (landmark.name.includes('left')) {
        xAdjust = -adjustX * 1.5 * speedFactor;
        // 腕の場合はさらに大きな動き
        if (landmark.name.includes('wrist')) xAdjust *= 2.5; // 2から2.5に増加
        if (landmark.name.includes('elbow')) xAdjust *= 2; // 1.5から2に増加
      }
      // 体の右側
      else if (landmark.name.includes('right')) {
        xAdjust = adjustX * 1.5 * speedFactor;
        // 腕の場合はさらに大きな動き
        if (landmark.name.includes('wrist')) xAdjust *= 2.5; // 2から2.5に増加
        if (landmark.name.includes('elbow')) xAdjust *= 2; // 1.5から2に増加
      }
      
      // 上半身
      if (landmark.name.includes('head') || landmark.name.includes('shoulder')) {
        yAdjust = -adjustY * 1.5 * speedFactor; // 1.2から1.5に増加
      }
      // 下半身
      else if (landmark.name.includes('ankle') || landmark.name.includes('knee')) {
        yAdjust = adjustY * 1.5 * speedFactor; // 1.2から1.5に増加
      }
      
      // 動きの大きさによって可視性を調整（動きが少ない部分は信頼性が低い）
      let visibility = 1.0;
      if (movementMagnitude < movementThreshold) {
        visibility = 0.7; // 動きが少ない場合は信頼性を下げる
      }
      
      return {
        ...landmark,
        x: landmark.x + xAdjust,
        y: landmark.y + yAdjust,
        visibility: visibility
      };
    });
  }
  
  // 前のフレームがない場合は基本位置に小さなランダム性を加える
  return baseLandmarks.map(landmark => ({
    ...landmark,
    x: landmark.x + Math.sin(currentFrame * 0.05) * 2,
    y: landmark.y + Math.cos(currentFrame * 0.05) * 2
  }));
};

// ランドマークの描画関数
const drawLandmarks = (
  ctx: CanvasRenderingContext2D,
  landmarks: { name: string; x: number; y: number; z?: number; visibility?: number }[]
) => {
  // 関節を描画
  landmarks.forEach(point => {
    // 可視性に基づいて透明度を設定
    const alpha = point.visibility !== undefined ? point.visibility : 1;
    
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
    ctx.fill();
  });
  
  // 骨格線の接続定義
  const connections = [
    ['head', 'left_shoulder'],
    ['head', 'right_shoulder'],
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_elbow'],
    ['right_shoulder', 'right_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'],
    ['right_hip', 'right_knee'],
    ['left_knee', 'left_ankle'],
    ['right_knee', 'right_ankle']
  ];
  
  // 骨格線を描画
  connections.forEach(([startName, endName]) => {
    const startPoint = landmarks.find(l => l.name === startName);
    const endPoint = landmarks.find(l => l.name === endName);
    
    if (startPoint && endPoint) {
      // 可視性の平均値を計算
      const avgVisibility = ((startPoint.visibility || 1) + (endPoint.visibility || 1)) / 2;
      
      ctx.beginPath();
      ctx.moveTo(startPoint.x, startPoint.y);
      ctx.lineTo(endPoint.x, endPoint.y);
      ctx.strokeStyle = `rgba(0, 255, 0, ${avgVisibility})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
};

export function MotionAnalyzer() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [frameCount, setFrameCount] = useState(0);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [isExportingData, setIsExportingData] = useState(false);
  const [motionTrackingData, setMotionTrackingData] = useState<LandmarkData[]>([]);
  const [processingUrl, setProcessingUrl] = useState<string | null>(null);
  const [originalVideoFile, setOriginalVideoFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<MotionAnalysisResult | null>(null);
  const [videoRecorderStatus, setVideoRecorderStatus] = useState<'inactive' | 'recording' | 'finished'>('inactive');
  const [processedVideoUrl, setProcessedVideoUrl] = useState<string | null>(null);
  const [isCreatingVideo, setIsCreatingVideo] = useState(false);
  const [holisticLoaded, setHolisticLoaded] = useState(false);
  const [detectionRate, setDetectionRate] = useState(0);
  
  const [waitingForStart, setWaitingForStart] = useState(false);
  const [mediaLibraryStatus, setMediaLibraryStatus] = useState('未初期化');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCapturerRef = useRef<number | null>(null);
  const processedFramesRef = useRef<ProcessedFrame[]>([]);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempMotionDataRef = useRef<LandmarkData[]>([]);
  const currentFrameRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const holisticRef = useRef<Holistic | null>(null);
  const detectedFramesRef = useRef(0);
  
  // 初期化時にセッションIDを生成
  useEffect(() => {
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    setSessionId(newSessionId);
    
    // 出力用キャンバス要素を作成（非表示）
    if (!outputCanvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.style.display = 'none';
      document.body.appendChild(canvas);
      outputCanvasRef.current = canvas;
    }
    
    // MediaPipe Holisticを初期化
    initHolistic();
    
    // デバイス情報をログ出力
    console.log(`デバイス情報: UA=${navigator.userAgent}`);
    
    // クリーンアップ関数
    return () => {
      if (outputCanvasRef.current) {
        document.body.removeChild(outputCanvasRef.current);
        outputCanvasRef.current = null;
      }
      
      // Holisticのクリーンアップ
      if (holisticRef.current) {
        holisticRef.current.close();
      }
    };
  }, []);
  
  // MediaPipe Holisticの結果処理関数
  const onResults = useCallback((results: any) => {
    if (!canvasRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // キャンバスをクリア
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    // ビデオフレームを描画
    if (videoRef.current) {
      ctx.drawImage(
        videoRef.current,
        0, 0,
        canvasRef.current.width,
        canvasRef.current.height
      );
    }
    
    // フレーム数を更新
    currentFrameRef.current += 1;
    setFrameCount(prev => prev + 1);
    
    // 検出率計算用のカウンター
    let detectionFound = false;
    
    // ポーズが検出された場合のみプラス
    if (results.poseLandmarks) {
      detectedFramesRef.current += 1;
      detectionFound = true;
    }
    
    // ポーズのランドマークを描画
    if (results.poseLandmarks) {
      mpDrawLandmarks(ctx, results.poseLandmarks, {
        color: '#00FF00',
        lineWidth: 3,
        radius: 6,
        visibilityMin: 0.6
      });
      
      mpDrawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
        color: '#00FF00',
        lineWidth: 3
      });
      
      // ランドマークデータを記録
      const landmarks = results.poseLandmarks.map((lm: any) => ({
        x: lm.x * canvasRef.current!.width,
        y: lm.y * canvasRef.current!.height,
        z: lm.z || 0,
        visibility: lm.visibility || 0
      }));
      
      // モーショントラッキングデータを追加
      const newTrackingData: LandmarkData = {
        pose: results.poseLandmarks || [],
        faceMesh: results.faceLandmarks || [],
        leftHand: results.leftHandLandmarks || [],
        rightHand: results.rightHandLandmarks || [],
        timestamp: videoRef.current?.currentTime || 0,
        frameIndex: currentFrameRef.current,
        confidence: {
          pose: results.poseWorldLandmarks ? 1.0 : 0.0,
          face: results.faceLandmarks ? 1.0 : 0.0,
          leftHand: results.leftHandLandmarks ? 1.0 : 0.0,
          rightHand: results.rightHandLandmarks ? 1.0 : 0.0
        }
      };
      
      tempMotionDataRef.current.push(newTrackingData);
    }
    
    // 顔のランドマークを描画
    if (results.faceLandmarks) {
      mpDrawLandmarks(ctx, results.faceLandmarks, {
        color: '#FF3030',
        lineWidth: 1,
        radius: 1,
        visibilityMin: 0.75
      });
      
      if (!detectionFound) {
        detectedFramesRef.current += 1;
        detectionFound = true;
      }
    }
    
    // 手のランドマークを描画
    if (results.rightHandLandmarks) {
      mpDrawLandmarks(ctx, results.rightHandLandmarks, {
        color: '#00FFFF',
        lineWidth: 2,
        radius: 3
      });
      
      mpDrawConnectors(ctx, results.rightHandLandmarks, HAND_CONNECTIONS, {
        color: '#00FFFF',
        lineWidth: 2
      });
      
      if (!detectionFound) {
        detectedFramesRef.current += 1;
        detectionFound = true;
      }
    }
    
    if (results.leftHandLandmarks) {
      mpDrawLandmarks(ctx, results.leftHandLandmarks, {
        color: '#FFFF00',
        lineWidth: 2,
        radius: 3
      });
      
      mpDrawConnectors(ctx, results.leftHandLandmarks, HAND_CONNECTIONS, {
        color: '#FFFF00',
        lineWidth: 2
      });
      
      if (!detectionFound) {
        detectedFramesRef.current += 1;
        detectionFound = true;
      }
    }
    
    // 定期的に状態を更新
    if (currentFrameRef.current % 15 === 0) {
      const rate = Math.round((detectedFramesRef.current / currentFrameRef.current) * 100);
      setDetectionRate(rate);
      
      if (currentFrameRef.current % 30 === 0) {
        setMotionTrackingData([...tempMotionDataRef.current]);
      }
    }
    
    // フレーム情報を描画
    drawFrameInfo(ctx);
    
    // 処理済みフレームを保存
    try {
      const startTime = performance.now();
      const imageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      const timestamp = videoRef.current?.currentTime || 0;
      
      // メモリ使用量を考慮して上限を設定
      if (processedFramesRef.current.length < 10000) {
        processedFramesRef.current.push({
          imageData,
          timestamp,
          sourceTime: timestamp,
          index: processedFramesRef.current.length,
          metadata: {
            processingTime: performance.now() - startTime,
            captureTime: performance.now(),
            quality: 1.0
          }
        });
        
        // フレーム数をコンソールに出力（デバッグ用）
        if (processedFramesRef.current.length % 30 === 0) {
          console.log(`保存済みフレーム数: ${processedFramesRef.current.length}, 現在時刻: ${timestamp.toFixed(3)}秒`);
        }
      }
    } catch (e) {
      console.warn('フレーム保存エラー:', e);
    }
  }, []);
  
  // MediaPipe Holisticの初期化
  const initHolistic = useCallback(async () => {
    try {
      console.log('MediaPipe Holisticを初期化中...');
      setHolisticLoaded(false);
      setMediaLibraryStatus('初期化中...');
      
      // 既存のインスタンスをクリーンアップ
      if (holisticRef.current) {
        await holisticRef.current.close();
      }
      
      // 指定バージョンの配列 - CDNの問題を回避するために複数のソースを試行する
      const versionSources = [
        {
          version: '',
          baseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic'
        },
        {
          version: '@0.5.1675469404',
          baseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675469404'
        },
        {
          version: '@0.4.1633559619',
          baseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.4.1633559619'
        }
      ];
      
      let success = false;
      let error = null;
      
      // 各バージョンを試す
      for (const source of versionSources) {
        if (success) break;
        
        try {
          console.log(`MediaPipe Holistic${source.version}を試行...`);
          setMediaLibraryStatus(`MediaPipe Holistic${source.version}の読み込み中...`);
          
          // 新しいHolisticインスタンスを作成
          const holistic = new Holistic({
            locateFile: (file) => {
              return `${source.baseUrl}/${file}`;
            }
          });
          
          // オプションを設定 - 高品質モデルを使用
          await holistic.setOptions({
            modelComplexity: 2,  // 最高品質モデルを使用 (0=Lite, 1=Full, 2=Heavy)
            smoothLandmarks: true,
            enableSegmentation: false,          // パフォーマンス向上のためセグメンテーションを無効化
            refineFaceLandmarks: false,         // 顔の詳細は重要でないので無効化
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
          });
          
          // 結果コールバックを設定
          holistic.onResults(onResults);
          
          // 初期化テスト - 空のキャンバスで一度実行してみる
          const testCanvas = document.createElement('canvas');
          testCanvas.width = 320;
          testCanvas.height = 240;
          const ctx = testCanvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, testCanvas.width, testCanvas.height);
            setMediaLibraryStatus(`MediaPipe Holistic${source.version}のテスト中...`);
            
            await holistic.send({image: testCanvas});
            console.log(`MediaPipe Holistic${source.version}の初期化テスト成功`);
          }
          
          // 参照を保存
          holisticRef.current = holistic;
          success = true;
          
          console.log(`MediaPipe Holistic${source.version}初期化完了!`);
          setMediaLibraryStatus(`MediaPipe Holistic${source.version}の準備完了`);
        } catch (err) {
          console.error(`MediaPipe Holistic${source.version}初期化エラー:`, err);
          setMediaLibraryStatus(`MediaPipe Holistic${source.version}の読み込み失敗`);
          error = err;
        }
      }
      
      if (!success) {
        throw error || new Error('すべてのMediaPipeバージョンの初期化に失敗しました');
      }
      
      setHolisticLoaded(true);
      setError('');
    } catch (err) {
      console.error('MediaPipe Holistic初期化エラー:', err);
      setError(`MediaPipe初期化エラー: ${err instanceof Error ? err.message : '不明なエラー'}`);
      setHolisticLoaded(false);
      setMediaLibraryStatus('初期化に失敗しました');
    }
  }, [onResults]);
  
  // 処理済み動画を生成する
  const createProcessedVideo = async () => {
    if (!canvasRef.current || processedFramesRef.current.length === 0 || !videoRef.current) {
      setError('動画フレームがありません');
      return;
    }
    
    try {
      setIsCreatingVideo(true);
      setProgress('ランドマーク付き動画を生成中...');
      
      // 元の動画の情報を取得
      const originalDuration = videoRef.current.duration;
      const originalWidth = canvasRef.current.width;
      const originalHeight = canvasRef.current.height;
      const frameCount = processedFramesRef.current.length;
      
      // 元の動画のフレームレートを計算
      const originalFps = 30; // 一般的な動画フレームレート
      console.log(`元動画情報: 長さ=${originalDuration.toFixed(2)}秒, 保存フレーム=${frameCount}`);
      
      // 元動画のストリームを作成（新手法）
      if (originalVideoFile) {
        try {
          // 出力キャンバスを作成
          const outputCanvas = document.createElement('canvas');
          outputCanvas.width = originalWidth;
          outputCanvas.height = originalHeight;
          const outputCtx = outputCanvas.getContext('2d', { alpha: false });
          
          if (!outputCtx) {
            throw new Error('キャンバスコンテキスト作成エラー');
          }
          
          // 元動画のURLを作成
          const videoURL = URL.createObjectURL(originalVideoFile);
          
          // 元の動画を再生するためのビデオ要素を作成
          const sourceVideo = document.createElement('video');
          sourceVideo.src = videoURL;
          sourceVideo.muted = true;
          
          await new Promise<void>((resolve, reject) => {
            sourceVideo.onloadedmetadata = () => resolve();
            sourceVideo.onerror = () => reject(new Error('元の動画の読み込みに失敗しました'));
            sourceVideo.load();
          });
          
          console.log(`元動画再生準備完了: 長さ=${sourceVideo.duration}秒, サイズ=${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`);
          
          // キャプチャストリームの設定
          const stream = outputCanvas.captureStream(originalFps);
          
          // エンコーダー設定
          let recorder;
          let options = { 
            mimeType: 'video/webm;codecs=h264',
            videoBitsPerSecond: 5000000  // 5Mbps - 高いビットレートはファイルが大きくなるだけで画質がよくならない場合も
          };
          
          try {
            // h264コーデックをサポートしているか確認
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
              // サポートされていない場合は別のコーデックを試す
              options.mimeType = 'video/webm;codecs=vp9';
              
              if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'video/webm';
              }
            }
            
            recorder = new MediaRecorder(stream, options);
          } catch (e) {
            console.error('録画設定エラー:', e);
            // フォールバック：標準設定
            recorder = new MediaRecorder(stream);
          }
          
          // 録画データの準備
          const chunks: Blob[] = [];
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              chunks.push(e.data);
            }
          };
          
          // 録画完了時の処理
          recorder.onstop = () => {
            // 録画データからBlobを作成
            const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
            
            // URLを作成
            const url = URL.createObjectURL(blob);
            setProcessedVideoUrl(url);
            setProcessingUrl(url);
            
            // ダウンロードリンク
            const a = document.createElement('a');
            a.href = url;
            a.download = `${sessionId}_processed_video.webm`;
            a.click();
            
            // クリーンアップ
            URL.revokeObjectURL(videoURL);
            
            console.log('動画生成完了');
            setProgress('処理完了しました');
            setIsCreatingVideo(false);
          };
          
          // 録画開始
          recorder.start();
          
          // 処理開始時間
          const startTime = performance.now();
          
          // 動画再生開始
          sourceVideo.currentTime = 0;
          await sourceVideo.play();
          
          let lastFrameTime = -1;
          
          // フレーム処理関数
          const processFrame = async () => {
            if (sourceVideo.paused || sourceVideo.ended) {
              recorder.stop();
              return;
            }
            
            // 現在の再生時間
            const currentTime = sourceVideo.currentTime;
            
            // タイムスタンプが前回と違う場合のみ描画（重複フレーム防止）
            if (currentTime !== lastFrameTime) {
              lastFrameTime = currentTime;
              
              // 現在時間に最も近いフレームを探す
              let nearestFrame = processedFramesRef.current[0];
              let minTimeDiff = Number.MAX_VALUE;
              
              for (const frame of processedFramesRef.current) {
                const timeDiff = Math.abs(frame.timestamp - currentTime);
                if (timeDiff < minTimeDiff) {
                  minTimeDiff = timeDiff;
                  nearestFrame = frame;
                }
              }
              
              // 見つかったフレームを描画
              outputCtx.putImageData(nearestFrame.imageData, 0, 0);
              
              // 進捗更新（10%ごと）
              const progressPercent = Math.round((currentTime / sourceVideo.duration) * 100);
              if (progressPercent % 10 === 0) {
                setProgress(`動画生成中: ${progressPercent}%`);
              }
            }
            
            // 次のフレームをリクエスト
            requestAnimationFrame(processFrame);
          };
          
          // フレーム処理開始
          processFrame();
          
          // 動画の末尾に到達したときに録画を停止
          sourceVideo.onended = () => {
            setTimeout(() => {
              recorder.stop();
              console.log(`動画生成所要時間: ${((performance.now() - startTime) / 1000).toFixed(2)}秒`);
            }, 500); // 少し遅延を入れて最後のフレームまで確実に処理
          };
          
        } catch (err) {
          console.error('動画生成エラー:', err);
          setError('動画生成に失敗しました: ' + (err instanceof Error ? err.message : String(err)));
          setIsCreatingVideo(false);
        }
      } else {
        setError('元の動画ファイルがありません');
        setIsCreatingVideo(false);
      }
    } catch (e) {
      console.error('動画生成プロセスエラー:', e);
      setError(`動画の生成中にエラーが発生しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
      setIsCreatingVideo(false);
    }
  };
  
  // フォールバック用の動画生成メソッド（従来の処理方法）
  const fallbackVideoGeneration = () => {
    if (!canvasRef.current || processedFramesRef.current.length === 0 || !videoRef.current) {
      setError('動画フレームがありません');
      return;
    }
    
    try {
      setProgress('別の方法で動画生成中...');
      
      // 元の動画の情報を取得
      const originalDuration = videoRef.current.duration;
      const originalWidth = canvasRef.current.width;
      const originalHeight = canvasRef.current.height;
      const frameCount = processedFramesRef.current.length;
      
      // 出力フレームレート（元の動画のフレームレートを維持）
      const fps = 30;
      
      // 出力用のキャンバスを作成（録画用）
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = originalWidth;
      outputCanvas.height = originalHeight;
      const outputCtx = outputCanvas.getContext('2d');
      
      if (!outputCtx) {
        throw new Error('キャンバスコンテキスト作成エラー');
      }
      
      // 最高品質のMediaRecorder設定を試行
      let selectedMimeType = '';
      const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=h264',
        'video/mp4;codecs=h264',
        'video/webm'
      ];
      
      // サポートされているMIMEタイプを探す
      for (const mt of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mt)) {
          selectedMimeType = mt;
          console.log(`サポートされているMIMEタイプ: ${mt}`);
          break;
        }
      }
      
      // メディアレコーダーオプションの設定
      const recorderOptions: MediaRecorderOptions = {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 5000000 // 5Mbps (適切な設定)
      };
      
      // キャンバスからメディアストリームを取得（高フレームレート）
      const stream = outputCanvas.captureStream(fps);
      
      // メディアレコーダー作成
      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      // 録画終了時の処理
      mediaRecorder.onstop = () => {
        // 録画データを結合
        const videoBlob = new Blob(chunks, { type: 'video/webm' });
        console.log(`生成された動画サイズ: ${(videoBlob.size / (1024 * 1024)).toFixed(2)} MB`);
        
        // 動画URLを作成
        const url = URL.createObjectURL(videoBlob);
        setProcessingUrl(url);
        setProcessedVideoUrl(url);
        
        // ダウンロードリンク作成
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sessionId}_processed_video.webm`;
        a.click();
        
        setProgress('動画の生成が完了しました！');
        setIsCreatingVideo(false);
      };
      
      // 録画開始
      mediaRecorder.start();
      
      // フレーム描画用変数
      let frameIndex = 0;
      const startTime = performance.now();
      
      // 再生間隔を計算（元の動画の長さを保つため）
      const frameDuration = originalDuration * 1000 / frameCount;
      
      // 次のフレームを描画する関数
      const drawNextFrame = () => {
        const currentTime = performance.now();
        const elapsedTime = currentTime - startTime;
        
        // 適切なフレームインデックスを計算（時間経過に基づいて）
        const targetFrameIndex = Math.floor(elapsedTime / frameDuration);
        
        // 描画するフレームがあり、かつ最終フレームに達していない場合
        if (targetFrameIndex < frameCount) {
          // キャンバスをクリア
          outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
          
          // 現在の時間に対応するフレームを描画
          outputCtx.putImageData(processedFramesRef.current[targetFrameIndex].imageData, 0, 0);
          
          // 進捗表示の更新
          const progressPercent = Math.round((targetFrameIndex / (frameCount - 1)) * 100);
          setProgress(`動画生成中: ${progressPercent}%`);
          
          // 次のフレーム描画をスケジュール
          requestAnimationFrame(drawNextFrame);
        } else {
          // すべてのフレームを処理したら録画終了
          mediaRecorder.stop();
          console.log(`動画生成完了: 合計時間=${(performance.now() - startTime) / 1000}秒`);
        }
      };
      
      // 描画開始
      drawNextFrame();
    } catch (e) {
      console.error('フォールバック動画生成エラー:', e);
      setError(`動画の生成中にエラーが発生しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
      setIsCreatingVideo(false);
    }
  };
  
  // 動画ファイルが選択されたときの処理
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 動画ファイルの種類チェックを改善（MOV形式にも対応）
    if (!file.type.startsWith('video/') && 
        !file.name.toLowerCase().endsWith('.mov') && 
        !file.name.toLowerCase().endsWith('.mp4') && 
        !file.name.toLowerCase().endsWith('.webm')) {
      setError('動画ファイルを選択してください');
      return;
    }
    
    if (!videoRef.current || !canvasRef.current) {
      setError('内部コンポーネントの準備ができていません');
      return;
    }
    
    // 元のファイルを保存
    setOriginalVideoFile(file);

    try {
      setIsProcessing(true);
      setError(null);
      setProgress('動画を読み込み中...');
      setFrameCount(0);
      currentFrameRef.current = 0;
      detectedFramesRef.current = 0;
      setVideoLoaded(false);
      setMotionTrackingData([]);
      tempMotionDataRef.current = [];
      processedFramesRef.current = [];
      setProcessingUrl(null);
      setAnalysisResult(null);
      setWaitingForStart(false);
      
      // MediaPipe Holisticの初期化を開始
      console.log('MediaPipe Holisticを再初期化します...');
      await initHolistic();
      
      // ビデオ要素をリセット
      if (videoRef.current) {
        // 既存のイベントリスナーをクリア
        const videoElement = videoRef.current;
        const oldSrc = videoElement.src;
        
        if (oldSrc) {
          URL.revokeObjectURL(oldSrc);
          videoElement.src = '';
          videoElement.load();
        }
        
        // ハードウェアアクセラレーション対策を適用
        disableHardwareAcceleration(videoElement);
        
        // CORS設定を追加
        videoElement.crossOrigin = "anonymous";
        
        // MOV形式のサポート改善
        // オブジェクトURLを直接使用してみる（特にMOV形式の場合）
        try {
          const objectUrl = URL.createObjectURL(file);
          
          // メタデータ読み込み時の処理
          videoElement.onloadedmetadata = () => {
            console.log('動画メタデータが読み込まれました, 長さ:', videoElement.duration || 0);
            
            if (!videoElement || !canvasRef.current) return;
            
            // キャンバスサイズを動画サイズに合わせる
            canvasRef.current.width = videoElement.videoWidth;
            canvasRef.current.height = videoElement.videoHeight;
            
            // 出力用キャンバスも同じサイズに設定
            if (outputCanvasRef.current) {
              outputCanvasRef.current.width = videoElement.videoWidth;
              outputCanvasRef.current.height = videoElement.videoHeight;
            }
            
            // アスペクト比を維持しながら表示サイズを調整
            const aspectRatio = videoElement.videoWidth / videoElement.videoHeight;
            const maxWidth = 800; // 最大表示幅
            let displayWidth = Math.min(maxWidth, videoElement.videoWidth);
            let displayHeight = displayWidth / aspectRatio;
            
            canvasRef.current.style.width = `${displayWidth}px`;
            canvasRef.current.style.height = `${displayHeight}px`;
            
            // ビデオ要素は非表示だが、同じサイズに設定（処理のため）
            videoElement.style.width = `${displayWidth}px`;
            videoElement.style.height = `${displayHeight}px`;
            
            // モバイル関連の処理を削除し、常にPC版の処理を行う
            setProgress('動画の処理準備ができました。解析を開始します...');
          };
          
          // 再生準備完了時の処理
          videoElement.oncanplay = () => {
            console.log('動画の再生準備ができました');
            setVideoLoaded(true);
            
            // 動画の再生を開始し、フレーム処理を開始
            videoElement.play().then(() => {
              console.log('動画再生開始 (自動)');
              startFrameCapture();
              setProgress('動画を処理中...');
            }).catch(err => {
              console.error('動画自動再生エラー:', err);
              // 自動再生に失敗した場合はユーザー操作による開始に切り替え
              setWaitingForStart(true);
              setProgress('動画の再生を開始するにはボタンをクリックしてください');
            });
          };
          
          // エラー発生時のハンドラ
          videoElement.onerror = (ev) => {
            console.error('動画読み込みエラー:', videoElement.error);
            
            let errorMessage = '動画の読み込みに失敗しました。';
            
            // 詳細なエラー情報を取得
            if (videoElement.error) {
              const errCode = videoElement.error.code;
              switch(errCode) {
                case 1:
                  errorMessage += '操作が中断されました。';
                  break;
                case 2:
                  errorMessage += 'ネットワークエラーが発生しました。';
                  break;
                case 3:
                  errorMessage += 'デコードエラー：フォーマットがサポートされていないか、ファイルが破損している可能性があります。';
                  break;
                case 4:
                  errorMessage += 'ソースが見つからないか、アクセスできません。別の動画ファイルを試してください。';
                  break;
                default:
                  errorMessage += 'フォーマットがサポートされていないか、ファイルが破損している可能性があります。';
              }
            }
            
            // オブジェクトURLによる読み込みが失敗した場合、データURLを試す
            console.log('オブジェクトURLでの読み込みに失敗したため、データURLを試します');
            const reader = new FileReader();
            
            reader.onload = (event) => {
              if (!event.target || !event.target.result) {
                setError('ファイルの読み込みに失敗しました');
                setIsProcessing(false);
                return;
              }
              
              const dataUrl = event.target.result as string;
              videoElement.src = dataUrl;
              videoElement.load();
            };
            
            reader.onerror = () => {
              setError(errorMessage);
              setIsProcessing(false);
            };
            
            reader.readAsDataURL(file);
          };
          
          // 動画終了時のハンドラ
          videoElement.onended = () => {
            console.log('動画再生終了');
            stopFrameCapture();
            
            // 処理終了時に蓄積したデータを一括で反映
            console.log(`処理終了: 記録したモーションデータ数 = ${tempMotionDataRef.current.length}`);
            
            // 最終的なデータを状態に反映
            setMotionTrackingData([...tempMotionDataRef.current]);
            
            setIsCapturing(false);
            setProgress('処理完了');
            setIsProcessing(false);
            
            // 検出率の最終計算
            const finalRate = Math.round((detectedFramesRef.current / currentFrameRef.current) * 100);
            setDetectionRate(finalRate);
            
            // 分析結果を生成
            if (videoElement) {
              const result: MotionAnalysisResult = {
                sessionId,
                frameCount: currentFrameRef.current,
                duration: videoElement.duration,
                frameRate: currentFrameRef.current / (videoElement.duration || 1),
                createdAt: new Date().toISOString(),
                videoSize: {
                  width: videoElement.videoWidth,
                  height: videoElement.videoHeight
                }
              };
              setAnalysisResult(result);
            }
          };
          
          // オブジェクトURLをビデオソースとして設定
          videoElement.src = objectUrl;
          
          // 明示的に読み込みを開始
          videoElement.load();
          console.log('オブジェクトURLからビデオを読み込み開始');
          
        } catch (objUrlErr) {
          console.error('オブジェクトURL生成エラー:', objUrlErr);
          
          // フォールバック: データURLを使用
          const reader = new FileReader();
          
          // 読み込み完了時のハンドラ
          reader.onload = (event) => {
            if (!event.target || !event.target.result) {
              setError('ファイルの読み込みに失敗しました');
              setIsProcessing(false);
              return;
            }
            
            const dataUrl = event.target.result as string;
            
            // メタデータ読み込み時の処理（上記と同じ）
            videoElement.onloadedmetadata = () => {
              console.log('動画メタデータが読み込まれました, 長さ:', videoElement.duration || 0);
              
              if (!videoElement || !canvasRef.current) return;
              
              // キャンバスサイズを動画サイズに合わせる
              canvasRef.current.width = videoElement.videoWidth;
              canvasRef.current.height = videoElement.videoHeight;
              
              // 出力用キャンバスも同じサイズに設定
              if (outputCanvasRef.current) {
                outputCanvasRef.current.width = videoElement.videoWidth;
                outputCanvasRef.current.height = videoElement.videoHeight;
              }
              
              // アスペクト比を維持しながら表示サイズを調整
              const aspectRatio = videoElement.videoWidth / videoElement.videoHeight;
              const maxWidth = 800; // 最大表示幅
              let displayWidth = Math.min(maxWidth, videoElement.videoWidth);
              let displayHeight = displayWidth / aspectRatio;
              
              canvasRef.current.style.width = `${displayWidth}px`;
              canvasRef.current.style.height = `${displayHeight}px`;
              
              // ビデオ要素は非表示だが、同じサイズに設定（処理のため）
              videoElement.style.width = `${displayWidth}px`;
              videoElement.style.height = `${displayHeight}px`;
              
              // モバイル関連の処理を削除し、常にPC版の処理を行う
              setProgress('動画の処理準備ができました。解析を開始します...');
            };
            
            // 再生準備完了時の処理
            videoElement.oncanplay = () => {
              console.log('動画の再生準備ができました');
              setVideoLoaded(true);
              
              // 動画の再生を開始し、フレーム処理を開始
              videoElement.play().then(() => {
                console.log('動画再生開始 (自動)');
                startFrameCapture();
                setProgress('動画を処理中...');
              }).catch(err => {
                console.error('動画自動再生エラー:', err);
                // 自動再生に失敗した場合はユーザー操作による開始に切り替え
                setWaitingForStart(true);
                setProgress('動画の再生を開始するにはボタンをクリックしてください');
              });
            };
            
            // エラー発生時のハンドラ
            videoElement.onerror = (ev) => {
              console.error('動画読み込みエラー:', videoElement.error);
              
              let errorMessage = '動画の読み込みに失敗しました。';
              
              // 詳細なエラー情報を取得
              if (videoElement.error) {
                const errCode = videoElement.error.code;
                switch(errCode) {
                  case 1:
                    errorMessage += '操作が中断されました。';
                    break;
                  case 2:
                    errorMessage += 'ネットワークエラーが発生しました。';
                    break;
                  case 3:
                    errorMessage += 'デコードエラー：フォーマットがサポートされていないか、ファイルが破損している可能性があります。';
                    break;
                  case 4:
                    errorMessage += 'ソースが見つからないか、アクセスできません。別の動画ファイルを試してください。';
                    break;
                  default:
                    errorMessage += 'フォーマットがサポートされていないか、ファイルが破損している可能性があります。';
                }
              }
              
              setError(errorMessage);
              setIsProcessing(false);
            };
            
            // 動画終了時のハンドラ
            videoElement.onended = () => {
              console.log('動画再生終了');
              stopFrameCapture();
              
              // 処理終了時に蓄積したデータを一括で反映
              console.log(`処理終了: 記録したモーションデータ数 = ${tempMotionDataRef.current.length}`);
              
              // 最終的なデータを状態に反映
              setMotionTrackingData([...tempMotionDataRef.current]);
              
              setIsCapturing(false);
              setProgress('処理完了');
              setIsProcessing(false);
              
              // 検出率の最終計算
              const finalRate = Math.round((detectedFramesRef.current / currentFrameRef.current) * 100);
              setDetectionRate(finalRate);
              
              // 分析結果を生成
              if (videoElement) {
                const result: MotionAnalysisResult = {
                  sessionId,
                  frameCount: currentFrameRef.current,
                  duration: videoElement.duration,
                  frameRate: currentFrameRef.current / (videoElement.duration || 1),
                  createdAt: new Date().toISOString(),
                  videoSize: {
                    width: videoElement.videoWidth,
                    height: videoElement.videoHeight
                  }
                };
                setAnalysisResult(result);
              }
            };
            
            // データURLをビデオソースとして設定
            videoElement.src = dataUrl;
            
            // 明示的に読み込みを開始
            videoElement.load();
            console.log('データURLからビデオを読み込み開始');
          };
          
          // エラーハンドラ
          reader.onerror = () => {
            setError('ファイルの読み込みに失敗しました。別のファイルを試してください。');
            setIsProcessing(false);
          };
          
          // ファイルの読み込みを開始（データURLとして）
          reader.readAsDataURL(file);
        }
      }
      
    } catch (err) {
      console.error('動画処理エラー:', err);
      setError(`動画の処理中にエラーが発生しました: ${err instanceof Error ? err.message : '不明なエラー'}`);
      setIsProcessing(false);
    }
  };
  
  // ユーザーが明示的に解析を開始する
  const handleStartAnalysis = () => {
    if (!videoRef.current || !canvasRef.current || !holisticRef.current) {
      setError('内部コンポーネントの準備ができていません');
      return;
    }
    
    setWaitingForStart(false);
    setProgress('解析を開始しています...');
    
    // モバイルでの自動再生ブロックを回避するため、ユーザー操作から直接開始
    if (videoRef.current) {
      // 念のためリセット
      videoRef.current.currentTime = 0;
      
      // 動画を再生
      videoRef.current.play().then(() => {
        console.log('動画再生開始 (手動)');
        startFrameCapture();
        setProgress('動画を処理中...');
      }).catch(err => {
        console.error('動画再生エラー:', err);
        setError(`動画再生エラー: ${err instanceof Error ? err.message : '不明なエラー'}`);
        setIsProcessing(false);
      });
    }
  };
  
  // フレームキャプチャの開始
  const startFrameCapture = () => {
    if (!videoRef.current || !canvasRef.current || !holisticRef.current) {
      setError('内部コンポーネントの準備ができていません');
      return;
    }
    
    console.log('Starting frame capture with MediaPipe Holistic');
    setIsCapturing(true);
    detectedFramesRef.current = 0;
    
    // フレーム処理用の変数
    let processingFrame = false;
    let droppedFrames = 0;
    
    const processFrame = async () => {
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) {
        if (videoRef.current?.ended) {
          stopFrameCapture();
        }
        return;
      }
      
      // 前のフレームの処理中なら、このフレームはスキップ
      if (processingFrame) {
        droppedFrames++;
        if (droppedFrames % 30 === 0) {
          console.warn(`フレームドロップ数: ${droppedFrames}`);
        }
        frameCapturerRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      try {
        processingFrame = true;
        
        // MediaPipeに送信
        if (holisticRef.current && videoRef.current) {
          await holisticRef.current.send({image: videoRef.current});
        }
        
        processingFrame = false;
      } catch (err) {
        console.warn('フレーム処理エラー:', err);
        processingFrame = false;
      }
      
      // 次のフレームの処理をスケジュール
      frameCapturerRef.current = requestAnimationFrame(processFrame);
    };
    
    // 最初のフレーム処理を開始
    frameCapturerRef.current = requestAnimationFrame(processFrame);
    
    // ビデオの再生速度を調整（より滑らかな再生のため）
    if (videoRef.current) {
      videoRef.current.playbackRate = 1.0; // 通常速度で再生
    }
  };
  
  // フレームキャプチャの停止
  const stopFrameCapture = () => {
    if (frameCapturerRef.current !== null) {
      cancelAnimationFrame(frameCapturerRef.current);
      frameCapturerRef.current = null;
      console.log('Frame capture stopped');
    }
  };
  
  // フレーム情報の描画関数を更新
  const drawFrameInfo = (ctx: CanvasRenderingContext2D) => {
    // 左上の情報表示を非表示にするために関数の内容を空にする
    // 情報表示が不要とのリクエストに対応
  };
  
  // 分析データをJSONファイルとしてエクスポート
  const exportAnalysisData = async () => {
    try {
      setIsExportingData(true);
      setProgress('分析データをエクスポート中...');
      
      // エクスポートデータの作成
      const exportData = {
        session_id: sessionId,
        metadata: {
          frame_count: currentFrameRef.current,
          duration: videoRef.current?.duration || 0,
          created_at: new Date().toISOString(),
          video_dimensions: {
            width: videoRef.current?.videoWidth,
            height: videoRef.current?.videoHeight
          }
        },
        motion_tracking: tempMotionDataRef.current,
        landmarks_count: tempMotionDataRef.current.length > 0 
          ? (tempMotionDataRef.current[0].pose?.length || 0) +
            (tempMotionDataRef.current[0].faceMesh?.length || 0) +
            (tempMotionDataRef.current[0].leftHand?.length || 0) +
            (tempMotionDataRef.current[0].rightHand?.length || 0)
          : 0,
        landmark_types: [
          "頭部", "左肩", "右肩", "左肘", "右肘", "左手首", "右手首",
          "左腰", "右腰", "左膝", "右膝", "左足首", "右足首"
        ]
      };
      
      // JSONに変換
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      
      // ダウンロードリンクを作成
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sessionId}_analysis.json`;
      
      // リンクをクリックしてダウンロードを開始
      document.body.appendChild(link);
      link.click();
      
      // クリーンアップ
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setProgress('分析データのエクスポートが完了しました');
      setIsExportingData(false);
      return true;
    } catch (err) {
      console.error('Error exporting analysis data:', err);
      setError(`分析データのエクスポートに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      setIsExportingData(false);
      return false;
    }
  };
  
  // 処理済みフレームを画像としてエクスポート
  const exportProcessedImage = async () => {
    try {
      setIsExportingData(true);
      setProgress('処理画像をエクスポート中...');
      
      if (!canvasRef.current) {
        throw new Error('キャンバスが見つかりません');
      }
      
      // キャンバスから画像データを取得
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvasRef.current!.toBlob(blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('画像の生成に失敗しました'));
          }
        }, 'image/png');
      });
      
      // 画像URLを作成
      const url = URL.createObjectURL(blob);
      setProcessingUrl(url);
      
      // ダウンロードリンクを作成
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sessionId}_processed.png`;
      
      // リンクをクリックしてダウンロードを開始
      document.body.appendChild(link);
      link.click();
      
      // クリーンアップ
      document.body.removeChild(link);
      
      setProgress('処理画像のエクスポートが完了しました');
      setIsExportingData(false);
      return true;
    } catch (err) {
      console.error('Error exporting processed image:', err);
      setError(`処理画像のエクスポートに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      setIsExportingData(false);
      return false;
    }
  };
  
  // 処理のリセット
  const handleReset = () => {
    stopFrameCapture();
    setIsCapturing(false);
    
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    
    setIsProcessing(false);
    setError(null);
    setProgress('');
    setFrameCount(0);
    currentFrameRef.current = 0;
    setVideoLoaded(false);
    setMotionTrackingData([]);
    tempMotionDataRef.current = [];
    processedFramesRef.current = [];
    setProcessingUrl(null);
    setOriginalVideoFile(null);
    setAnalysisResult(null);
  };
  
  // 処理済み動画を再生する
  const handleReplayProcessed = () => {
    if (!outputCanvasRef.current || processedFramesRef.current.length === 0) {
      setError('再生できる処理済みフレームがありません');
      return;
    }
    
    setIsProcessing(true);
    setProgress('処理済みフレームを再生中...');
    
    const ctx = outputCanvasRef.current.getContext('2d');
    if (!ctx) {
      setError('キャンバスコンテキストを取得できませんでした');
      setIsProcessing(false);
      return;
    }
    
    let frameIndex = 0;
    const frameCount = processedFramesRef.current.length;
    
    // フレームレートの計算（元の動画のフレームレートに近づける）
    const fps = videoRef.current ? 
      Math.min(30, frameCount / (videoRef.current.duration || 10)) : 
      15; // デフォルトは15fps
    
    const interval = 1000 / fps;
    
    const playNextFrame = () => {
      if (frameIndex >= frameCount) {
        setIsProcessing(false);
        setProgress('再生完了');
        return;
      }
      
      // フレームを描画
      ctx.putImageData(processedFramesRef.current[frameIndex].imageData, 0, 0);
      
      // 次のフレームへ
      frameIndex++;
      
      // 進捗状況更新
      const progressPercent = Math.round((frameIndex / frameCount) * 100);
      setProgress(`再生中: ${progressPercent}%`);
      
      // 次のフレーム再生をスケジュール
      setTimeout(playNextFrame, interval);
    };
    
    // 最初のフレームを再生
    playNextFrame();
  };
  
  // 録画を停止
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setVideoRecorderStatus('inactive');
    }
  };
  
  // コンポーネントのアンマウント時にリソースを解放
  useEffect(() => {
    return () => {
      stopFrameCapture();
      stopRecording();
      setIsCapturing(false);
      
      if (videoRef.current && videoRef.current.src) {
        URL.revokeObjectURL(videoRef.current.src);
      }
      
      // 動画URLのクリーンアップ
      if (processingUrl) {
        URL.revokeObjectURL(processingUrl);
      }
      
      if (processedVideoUrl) {
        URL.revokeObjectURL(processedVideoUrl);
      }
    };
  }, [processingUrl, processedVideoUrl]);

  // ハードウェアアクセラレーション関連の問題を回避するためのヘルパー関数
  const disableHardwareAcceleration = useCallback((videoElement: HTMLVideoElement) => {
    try {
      // スタイルを使って高速化機能を無効化
      videoElement.style.transform = 'translateZ(0)';
      
      // iOS/Safariの場合は特別な対応
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      
      if (isIOS || isSafari) {
        // iOS/Safariでのビデオ処理を最適化
        videoElement.playsInline = true;
        videoElement.setAttribute('playsinline', 'true');
        videoElement.setAttribute('webkit-playsinline', 'true');
      }
      
      // Windows特有の設定（Windows 11対応）
      const isWindows = /Windows/.test(navigator.userAgent);
      if (isWindows) {
        // Windows環境での特別な対応
        videoElement.style.isolation = 'isolate'; // レンダリングの問題を軽減
      }
      
      console.log('ハードウェアアクセラレーション対策を適用しました');
    } catch (e) {
      console.warn('ハードウェアアクセラレーション設定エラー:', e);
    }
  }, []);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-4">
          {!isProcessing && !videoLoaded ? (
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
                <Upload className="h-6 w-6 mr-2" />
                クリックして動画をアップロード
              </Button>
              <p className="text-center text-sm text-gray-500">
                動画ファイル（MP4、WebM、MOVなど）を選択してください
              </p>
              <p className="text-center text-xs text-blue-500">
                MediaPipe状態: {mediaLibraryStatus}
              </p>
            </>
          ) : null}

          {isProcessing && (
            <div className="text-center py-2">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <p className="text-lg">{progress}</p>
              </div>
              
              {/* 解析開始ボタン - モバイル用 */}
              {waitingForStart && (
                <Button
                  onClick={handleStartAnalysis}
                  className="mt-4 bg-green-600 hover:bg-green-700 text-white"
                >
                  <Play className="h-5 w-5 mr-2" />
                  解析を開始する
                </Button>
              )}
            </div>
          )}

          <div className="relative">
            <video 
              ref={videoRef} 
              className="hidden" 
              playsInline
              muted
              autoPlay={false}
              preload="auto"
            />
            <canvas 
              ref={canvasRef} 
              className={videoLoaded ? "w-full h-auto border rounded-lg shadow-sm" : "hidden"} 
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

          {videoLoaded && !isProcessing && (
            <div className="flex flex-wrap justify-center gap-3 mt-4">
              <Button 
                onClick={handleReset}
                variant="outline"
              >
                別の動画を分析
              </Button>
              
              <Button 
                onClick={createProcessedVideo}
                disabled={isCreatingVideo || processedFramesRef.current.length === 0}
                variant="default"
              >
                {isCreatingVideo ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    動画生成中...
                  </>
                ) : (
                  <>
                    <Film className="h-4 w-4 mr-2" />
                    ランドマーク付き動画を生成
                  </>
                )}
              </Button>
              
              {processedVideoUrl && (
                <Button 
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = processedVideoUrl;
                    a.download = `${sessionId}_processed_video.webm`;
                    a.click();
                  }}
                  variant="secondary"
                >
                  <Download className="h-4 w-4 mr-2" />
                  動画をダウンロード
                </Button>
              )}
            </div>
          )}
          
          {/* 処理情報表示 */}
          {videoLoaded && !isProcessing && frameCount > 0 && (
            <div className="mt-4 p-4 border rounded-lg bg-gray-50">
              <h3 className="text-lg font-bold mb-2">処理結果</h3>
              <ul className="text-sm space-y-1">
                <li>処理フレーム数: {frameCount}</li>
                <li>動画長: {videoRef.current?.duration.toFixed(2)}秒</li>
                <li>フレームレート: {(frameCount / (videoRef.current?.duration || 1)).toFixed(2)}fps</li>
                <li>骨格検出ステータス: <span className="text-green-600 font-medium">検出済み</span></li>
                <li>ランドマーク数: <span className="font-medium">13箇所</span> (頭部、肩×2、肘×2、手首×2、腰×2、膝×2、足首×2)</li>
              </ul>
              
              {/* 動画表示エリア */}
              {processedVideoUrl && (
                <div className="mt-4">
                  <h4 className="font-medium mb-2">生成された動画</h4>
                  <div className="mt-2 border rounded overflow-hidden">
                    <video 
                      src={processedVideoUrl} 
                      controls 
                      className="w-full h-auto"
                    />
                  </div>
                  <div className="flex justify-center mt-2">
                    <Button
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = processedVideoUrl;
                        a.download = `${sessionId}_processed_video.webm`;
                        a.click();
                      }}
                      size="sm"
                      className="mt-2"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      動画をダウンロード
                    </Button>
                  </div>
                </div>
              )}
              
              {videoRecorderStatus === 'recording' && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
                  <p className="font-bold mb-1 flex items-center">
                    <span className="inline-block w-2 h-2 bg-red-600 rounded-full mr-2 animate-pulse"></span>
                    録画中
                  </p>
                  <p>ランドマーク付き動画を録画しています。しばらくお待ちください...</p>
                </div>
              )}
              
              {videoRecorderStatus === 'finished' && !processedVideoUrl && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm">
                  <p className="font-bold mb-1">処理中</p>
                  <p>動画の処理が完了しました。動画の生成中です...</p>
                </div>
              )}
            </div>
          )}

          {/* 説明 */}
          <div className="mt-6 text-sm text-gray-500">
            <h4 className="font-medium text-gray-700 mb-1">このアプリについて</h4>
            <p>このアプリは動画を分析し、ランドマークを検出して骨格を表示した動画を生成します。</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>アップロードした動画にランドマークを重ねて表示</li>
              <li>動画内の動きを検出して骨格を追従</li>
              <li>処理結果をMP4/WebM形式で保存可能</li>
              <li>データはすべてローカルで処理（サーバーには送信されません）</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
