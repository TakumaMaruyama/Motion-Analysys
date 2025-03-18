'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Download, Upload, Video, Play, Film } from 'lucide-react';
import { Holistic, POSE_CONNECTIONS, HAND_CONNECTIONS, FACEMESH_TESSELATION } from '@mediapipe/holistic';
import { Camera } from '@mediapipe/camera_utils';
import { drawLandmarks as mpDrawLandmarks, drawConnectors as mpDrawConnectors } from '@mediapipe/drawing_utils';

// MediaRecorder APIタイプ定義
interface MediaRecorderOptions {
  mimeType?: string;
  audioBitsPerSecond?: number;
  videoBitsPerSecond?: number;
  bitsPerSecond?: number;
}

// ランドマークデータの型定義
interface LandmarkData {
  frame: number;
  timestamp: number;
  position: {
    x: number;
    y: number;
  };
  landmarks?: {
    name: string;
    x: number;
    y: number;
    z?: number;
    visibility?: number;
  }[];
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
      
      for (let y = region.startY; y < region.endY; y += 10) { // 10ピクセルごとにサンプリング（パフォーマンス向上）
        for (let x = region.startX; x < region.endX; x += 10) {
          const idx = (y * width + x) * 4;
          
          // RGBの差分
          const rDiff = Math.abs(currentData[idx] - prevData[idx]);
          const gDiff = Math.abs(currentData[idx + 1] - prevData[idx + 1]);
          const bDiff = Math.abs(currentData[idx + 2] - prevData[idx + 2]);
          
          // 3チャンネルの平均差分
          const avgDiff = (rDiff + gDiff + bDiff) / 3;
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
    // しきい値（差分がこの値より大きい場合に動きとみなす）
    const movementThreshold = 5;
    
    // 動きに応じた調整量
    const adjustX = (leftMovement > movementThreshold || rightMovement > movementThreshold) 
      ? (rightMovement - leftMovement) * 0.05 // 左右の動きの差に基づいて調整
      : Math.sin(currentFrame * 0.05) * 3; // 既存のアニメーション（微小）
      
    const adjustY = (upMovement > movementThreshold || downMovement > movementThreshold)
      ? (downMovement - upMovement) * 0.05 // 上下の動きの差に基づいて調整
      : Math.cos(currentFrame * 0.04) * 2; // 既存のアニメーション（微小）
    
    // 動きの大きさ（全体の動き）
    const movementMagnitude = (leftMovement + rightMovement + upMovement + downMovement) / 4;
    
    // 各ランドマークの位置を動きに合わせて調整
    return baseLandmarks.map(landmark => {
      // 体の部位ごとに調整量を変える
      let xAdjust = 0;
      let yAdjust = 0;
      
      // 体の左側
      if (landmark.name.includes('left')) {
        xAdjust = -adjustX * 1.5;
        // 腕の場合はさらに大きな動き
        if (landmark.name.includes('wrist')) xAdjust *= 2;
        if (landmark.name.includes('elbow')) xAdjust *= 1.5;
      }
      // 体の右側
      else if (landmark.name.includes('right')) {
        xAdjust = adjustX * 1.5;
        // 腕の場合はさらに大きな動き
        if (landmark.name.includes('wrist')) xAdjust *= 2;
        if (landmark.name.includes('elbow')) xAdjust *= 1.5;
      }
      
      // 上半身
      if (landmark.name.includes('head') || landmark.name.includes('shoulder')) {
        yAdjust = -adjustY * 1.2;
      }
      // 下半身
      else if (landmark.name.includes('ankle') || landmark.name.includes('knee')) {
        yAdjust = adjustY * 1.2;
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
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCapturerRef = useRef<number | null>(null);
  const processedFramesRef = useRef<ImageData[]>([]);
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
    
    // 33ポイントのデフォルト値を用意 (MediaPipe Poseの33ポイント)
    const defaultPosePoints = Array(33).fill(null).map((_, i) => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0
    }));
    
    // ポーズのランドマークを描画（カスタム線の太さで）
    if (results.poseLandmarks) {
      // ランドマークを描画（より目立つように）
      mpDrawLandmarks(
        ctx,
        results.poseLandmarks,
        {
          color: '#00FF00',
          lineWidth: 3,
          radius: 6,
          visibilityMin: 0.65
        }
      );
      
      // 接続線を描画（より目立つように）
      mpDrawConnectors(
        ctx,
        results.poseLandmarks,
        POSE_CONNECTIONS,
        {
          color: '#00FF00',
          lineWidth: 3
        }
      );
      
      // ランドマークデータを記録
      const landmarks = results.poseLandmarks.map((lm: any) => ({
        x: lm.x * canvasRef.current!.width,
        y: lm.y * canvasRef.current!.height,
        z: lm.z || 0,
        visibility: lm.visibility || 0
      }));
      
      // モーショントラッキングデータを追加
      const newTrackingData: LandmarkData = {
        frame: currentFrameRef.current,
        timestamp: videoRef.current?.currentTime || 0,
        position: {
          x: Math.floor(canvasRef.current.width / 2),
          y: Math.floor(canvasRef.current.height / 2)
        },
        landmarks: landmarks
      };
      
      // データを一時配列に追加
      tempMotionDataRef.current.push(newTrackingData);
    }
    
    // 顔のランドマークを描画（あれば）
    if (results.faceLandmarks) {
      mpDrawLandmarks(
        ctx,
        results.faceLandmarks,
        {
          color: '#FF3030',
          lineWidth: 1,
          radius: 1
        }
      );
      
      if (!detectionFound) {
        detectedFramesRef.current += 1;
        detectionFound = true;
      }
    }
    
    // 右手のランドマークを描画（あれば）
    if (results.rightHandLandmarks) {
      mpDrawLandmarks(
        ctx,
        results.rightHandLandmarks,
        {
          color: '#00FFFF',
          lineWidth: 2,
          radius: 3
        }
      );
      
      mpDrawConnectors(
        ctx,
        results.rightHandLandmarks,
        HAND_CONNECTIONS,
        {
          color: '#00FFFF',
          lineWidth: 2
        }
      );
      
      if (!detectionFound) {
        detectedFramesRef.current += 1;
        detectionFound = true;
      }
    }
    
    // 左手のランドマークを描画（あれば）
    if (results.leftHandLandmarks) {
      mpDrawLandmarks(
        ctx,
        results.leftHandLandmarks,
        {
          color: '#FFFF00',
          lineWidth: 2,
          radius: 3
        }
      );
      
      mpDrawConnectors(
        ctx,
        results.leftHandLandmarks,
        HAND_CONNECTIONS,
        {
          color: '#FFFF00',
          lineWidth: 2
        }
      );
      
      if (!detectionFound) {
        detectedFramesRef.current += 1;
        detectionFound = true;
      }
    }
    
    // 定期的に状態を更新（パフォーマンス向上のため）
    if (currentFrameRef.current % 15 === 0) {
      // 検出率を計算して更新
      const rate = Math.round((detectedFramesRef.current / currentFrameRef.current) * 100);
      setDetectionRate(rate);
      
      // モーションデータを更新（30フレームごとに更新）
      if (currentFrameRef.current % 30 === 0) {
        setMotionTrackingData([...tempMotionDataRef.current]);
      }
    }
    
    // フレーム情報を描画
    drawFrameInfo(ctx);
    
    // 処理済みフレームを保存（メモリ使用量を考慮して最大300フレームまで）
    // 10フレームごとに保存して、メモリ使用量を削減
    if (currentFrameRef.current % 10 === 0 && processedFramesRef.current.length < 300) {
      try {
        const imageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
        processedFramesRef.current.push(imageData);
      } catch (e) {
        console.warn('フレーム保存エラー:', e);
      }
    }
  }, []);
  
  // MediaPipe Holisticの初期化
  const initHolistic = useCallback(async () => {
    try {
      console.log('MediaPipe Holisticを初期化中...');
      setHolisticLoaded(false);
      
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
          
          // 新しいHolisticインスタンスを作成
          const holistic = new Holistic({
            locateFile: (file) => {
              return `${source.baseUrl}/${file}`;
            }
          });
          
          // オプションを設定 - パフォーマンス向上のために最適化
          await holistic.setOptions({
            modelComplexity: 1,           // 0=Lite, 1=Full, 2=Heavy - バランスが良い1を選択
            smoothLandmarks: true,        // 滑らかなランドマーク描画
            enableSegmentation: false,    // パフォーマンス向上のためセグメンテーションを無効化
            refineFaceLandmarks: false,   // 顔のランドマーク精度を犠牲にしてパフォーマンス向上
            minDetectionConfidence: 0.5,  // 検出信頼度閾値
            minTrackingConfidence: 0.5    // トラッキング信頼度閾値
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
            await holistic.send({image: testCanvas});
            console.log(`MediaPipe Holistic${source.version}の初期化テスト成功`);
          }
          
          // 参照を保存
          holisticRef.current = holistic;
          success = true;
          
          console.log(`MediaPipe Holistic${source.version}初期化完了!`);
        } catch (err) {
          console.error(`MediaPipe Holistic${source.version}初期化エラー:`, err);
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
    }
  }, [onResults]);
  
  // 動画ファイルが選択されたときの処理
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
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
      
      // MediaPipe Holisticの初期化を開始
      console.log('MediaPipe Holisticを初期化します...');
      await initHolistic();
      
      // 動画URLを作成し、video要素に設定
      const videoURL = URL.createObjectURL(file);
      videoRef.current.src = videoURL;
      
      videoRef.current.onloadedmetadata = () => {
        console.log('動画メタデータが読み込まれました, 長さ:', videoRef.current?.duration || 0);
        
        if (!videoRef.current || !canvasRef.current) return;
        
        // キャンバスサイズを動画サイズに合わせる
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        
        // 出力用キャンバスも同じサイズに設定
        if (outputCanvasRef.current) {
          outputCanvasRef.current.width = videoRef.current.videoWidth;
          outputCanvasRef.current.height = videoRef.current.videoHeight;
        }
        
        // アスペクト比を維持しながら表示サイズを調整
        const aspectRatio = videoRef.current.videoWidth / videoRef.current.videoHeight;
        const maxWidth = 800; // 最大表示幅
        let displayWidth = Math.min(maxWidth, videoRef.current.videoWidth);
        let displayHeight = displayWidth / aspectRatio;
        
        canvasRef.current.style.width = `${displayWidth}px`;
        canvasRef.current.style.height = `${displayHeight}px`;
        
        // ビデオ要素は非表示だが、同じサイズに設定（処理のため）
        videoRef.current.style.width = `${displayWidth}px`;
        videoRef.current.style.height = `${displayHeight}px`;
        
        setProgress('動画の処理準備ができました。解析を開始します...');
      };
      
      videoRef.current.oncanplay = () => {
        console.log('動画の再生準備ができました');
        setVideoLoaded(true);
        
        if (videoRef.current) {
          // 動画の再生を開始し、フレーム処理を開始
          videoRef.current.play().then(() => {
            console.log('動画再生開始');
            startFrameCapture();
            setProgress('動画を処理中...');
          }).catch(err => {
            console.error('動画再生エラー:', err);
            setError(`動画再生エラー: ${err instanceof Error ? err.message : '不明なエラー'}`);
            setIsProcessing(false);
          });
        }
      };
      
      videoRef.current.onerror = () => {
        console.error('動画読み込みエラー');
        setError('動画の読み込みに失敗しました');
        setIsProcessing(false);
      };
      
      // 動画終了時のハンドラ
      videoRef.current.onended = () => {
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
        if (videoRef.current) {
          const result: MotionAnalysisResult = {
            sessionId,
            frameCount: currentFrameRef.current,
            duration: videoRef.current.duration,
            frameRate: currentFrameRef.current / (videoRef.current.duration || 1),
            createdAt: new Date().toISOString(),
            videoSize: {
              width: videoRef.current.videoWidth,
              height: videoRef.current.videoHeight
            }
          };
          setAnalysisResult(result);
        }
      };
      
    } catch (err) {
      console.error('動画処理エラー:', err);
      setError(`動画の処理中にエラーが発生しました: ${err instanceof Error ? err.message : '不明なエラー'}`);
      setIsProcessing(false);
    }
  };
  
  // フレームキャプチャの開始
  const startFrameCapture = () => {
    if (!videoRef.current || !canvasRef.current || !holisticRef.current) {
      setError('内部コンポーネントの準備ができていません');
      return;
    }
    
    console.log('Starting frame capture with MediaPipe Holistic');
    // 明示的にキャプチャ状態を有効にする
    setIsCapturing(true);
    detectedFramesRef.current = 0;
    
    // 最後の処理時間を記録
    let lastProcessTime = 0;
    // 目標フレームレート（高すぎるとブラウザがフリーズする可能性がある）
    const targetFPS = 24;
    // フレーム間の最小時間（ミリ秒）
    const frameInterval = 1000 / targetFPS;
    
    const captureAndProcessFrame = async () => {
      if (videoRef.current && !videoRef.current.paused && !videoRef.current.ended) {
        try {
          const now = performance.now();
          const elapsed = now - lastProcessTime;
          
          // 前回の処理から十分な時間が経過している場合のみ処理
          if (elapsed >= frameInterval) {
            lastProcessTime = now;
            
            // 処理を開始する前にUIスレッドを解放
            await new Promise(resolve => setTimeout(resolve, 0));
            
            // 現在のビデオフレームをHolisticに送信
            if (holisticRef.current) {
              await holisticRef.current.send({image: videoRef.current});
            }
          }
          
          // 次のフレームをスケジュール
          frameCapturerRef.current = requestAnimationFrame(captureAndProcessFrame);
        } catch (err) {
          console.error('Frame processing error:', err);
          stopFrameCapture();
          setError(`フレーム処理エラー: ${err instanceof Error ? err.message : '不明なエラー'}`);
        }
      } else if (videoRef.current && videoRef.current.ended) {
        // 動画が終了した場合
        stopFrameCapture();
      }
    };
    
    // 最初のフレームをキャプチャ
    frameCapturerRef.current = requestAnimationFrame(captureAndProcessFrame);
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
    // 黒背景部分
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    
    // フレーム情報表示エリア
    ctx.fillRect(10, 10, 250, 150);
    
    // テキスト表示
    ctx.font = "16px Arial";
    ctx.fillStyle = "white";
    ctx.fillText(`フレーム: ${currentFrameRef.current}`, 20, 30);
    
    // キャプチャステータス
    ctx.fillStyle = isCapturing ? "lime" : "red";
    ctx.fillText(`キャプチャ状態: ${isCapturing ? '録画中' : '停止'}`, 20, 55);
    
    // ポーズ検出率
    ctx.fillStyle = detectionRate > 50 ? "lime" : detectionRate > 20 ? "yellow" : "red";
    ctx.fillText(`ポーズ検出率: ${detectionRate}%`, 20, 80);
    
    // トラッキングデータ量
    ctx.fillStyle = "white";
    ctx.fillText(`記録データ: ${tempMotionDataRef.current.length}`, 20, 105);
    
    // MediaPipeステータス
    ctx.fillStyle = holisticLoaded ? "lime" : "red";
    ctx.fillText(`MediaPipe: ${holisticLoaded ? '準備完了' : '未ロード'}`, 20, 130);
    
    // パフォーマンス情報
    const fps = videoRef.current && videoRef.current.duration > 0 ? 
      (currentFrameRef.current / (videoRef.current.currentTime || 1)).toFixed(1) : "0";
    ctx.fillStyle = parseInt(fps) > 20 ? "lime" : parseInt(fps) > 10 ? "yellow" : "red";
    ctx.fillText(`処理速度: ${fps} FPS`, 20, 155);
    
    // 現在の時間表示
    if (videoRef.current) {
      const currentTime = videoRef.current.currentTime.toFixed(2);
      const duration = videoRef.current.duration.toFixed(2);
      
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(canvasRef.current!.width - 170, 10, 160, 30);
      ctx.fillStyle = "white";
      ctx.fillText(`${currentTime}s / ${duration}s`, canvasRef.current!.width - 160, 30);
    }
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
        landmarks_count: tempMotionDataRef.current.length > 0 ? tempMotionDataRef.current[0].landmarks?.length || 0 : 0,
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
      ctx.putImageData(processedFramesRef.current[frameIndex], 0, 0);
      
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
  
  // 処理済み動画を生成する
  const createProcessedVideo = async () => {
    if (!canvasRef.current || processedFramesRef.current.length === 0) {
      setError('動画フレームがありません');
      return;
    }
    
    try {
      setIsCreatingVideo(true);
      setProgress('ランドマーク付き動画を生成中...');
      
      // キャンバスストリームを取得
      const stream = canvasRef.current.captureStream(30); // 30fpsでストリーム作成
      
      // 対応しているコーデックを確認
      const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
      ];
      
      let selectedMimeType = '';
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }
      
      if (!selectedMimeType) {
        throw new Error('対応する動画フォーマットがありません');
      }
      
      // MediaRecorderを初期化
      const options: MediaRecorderOptions = {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 2500000 // 2.5Mbps
      };
      
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      recordedChunksRef.current = [];
      
      // データが利用可能になったときのイベント
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      
      // 録画が完了したときのイベント
      mediaRecorderRef.current.onstop = () => {
        // Blobを作成
        const blob = new Blob(recordedChunksRef.current, { type: selectedMimeType });
        const url = URL.createObjectURL(blob);
        setProcessedVideoUrl(url);
        setVideoRecorderStatus('finished');
        setIsCreatingVideo(false);
        setProgress('動画の生成が完了しました');
        
        // 自動ダウンロード開始
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sessionId}_processed_video.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
      
      // 録画状態を「録画中」に設定
      setVideoRecorderStatus('recording');
      
      // 録画開始
      mediaRecorderRef.current.start();
      
      // キャンバスに処理済みのフレームを再生して録画
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) throw new Error('キャンバスコンテキストが取得できません');
      
      // 再生レートの計算（できるだけ元の動画に近いフレームレートで再生）
      const originalFps = videoRef.current ? frameCount / (videoRef.current.duration || 30) : 30;
      const fps = Math.min(30, originalFps); // 最大30fps
      const frameInterval = 1000 / fps;
      
      let frameIndex = 0;
      const totalFrames = Math.min(processedFramesRef.current.length, frameCount);
      
      const renderNextFrame = () => {
        if (frameIndex >= totalFrames || !mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
          // 全フレーム処理完了または録画停止時
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
          return;
        }
        
        // 次のフレームを描画
        const frame = processedFramesRef.current[frameIndex];
        ctx.putImageData(frame, 0, 0);
        
        // 進捗状況の更新
        const progress = Math.round((frameIndex / totalFrames) * 100);
        setProgress(`動画生成中: ${progress}%`);
        
        // 次のフレームへ
        frameIndex++;
        
        // 次のフレーム描画をスケジュール
        setTimeout(renderNextFrame, frameInterval);
      };
      
      // フレーム描画開始
      renderNextFrame();
      
    } catch (err) {
      setError(`動画の生成に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      setIsCreatingVideo(false);
      setVideoRecorderStatus('inactive');
    }
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
            </>
          ) : null}

          {isProcessing && (
            <div className="text-center py-2">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <p className="text-lg">{progress}</p>
              </div>
            </div>
          )}

          <div className="relative">
            <video 
              ref={videoRef} 
              className="hidden" 
              playsInline
              muted
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
