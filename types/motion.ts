export interface Point {
  x: number;
  y: number;
}

export interface Point3D extends Point {
  z: number;
}

export interface Landmark extends Point3D {
  visibility?: number;
}

// 検出された全てのランドマーク情報
export interface LandmarkData {
  pose: Landmark[];
  faceMesh: Landmark[];
  leftHand: Landmark[];
  rightHand: Landmark[];
  timestamp: number;
  frameIndex: number;
  confidence: {
    pose: number;
    face: number;
    leftHand: number;
    rightHand: number;
  };
}

// 処理済みフレーム情報
export interface ProcessedFrame {
  imageData: ImageData;
  timestamp: number;
  sourceTime: number; // 元動画の時間
  landmarks?: LandmarkData;
  index: number;
  metadata: {
    processingTime: number; // 処理にかかった時間
    captureTime: number;    // キャプチャ時間
    quality: number;        // 品質スコア 0-1
  };
}

// 動画処理設定
export interface VideoProcessingConfig {
  input: {
    width: number;
    height: number;
    frameRate: number;
    sourceType: 'camera' | 'file';
  };
  detection: {
    enabled: boolean;
    confidence: {
      minimum: number;
      target: number;
    };
    smoothing: number;
    skipFrames: number;
  };
  output: {
    width: number;
    height: number;
    frameRate: number;
    quality: number; // 0-1
    format: 'mp4' | 'webm';
    codec: string;
  };
  performance: {
    useGPU: boolean;
    priorityMode: 'speed' | 'quality' | 'balanced';
    maxMemoryUsage: number; // MB
    useWorkers: boolean;
  };
}

// 動画処理状態
export interface ProcessingState {
  status: 'idle' | 'loading' | 'processing' | 'rendering' | 'completed' | 'error';
  progress: number; // 0-1
  stage: string;
  stats: {
    framesProcessed: number;
    framesDropped: number;
    averageFPS: number;
    peakMemoryUsage: number;
    processingTime: number;
    currentMemoryUsage: number;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

// 動画解析結果
export interface MotionAnalysisResult {
  sessionId: string;
  duration: number;
  frameCount: number;
  frameRate: number;
  resolution: {
    width: number;
    height: number;
  };
  landmarks: {
    count: number;
    averageConfidence: number;
  };
  createdAt: string;
  processingStats: {
    totalTime: number;
    peakMemoryUsage: number;
    averageProcessingTimePerFrame: number;
  };
} 