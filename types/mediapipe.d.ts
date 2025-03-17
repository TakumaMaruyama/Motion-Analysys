declare module '@mediapipe/pose' {
  export class Pose {
    constructor(options?: { locateFile?: (file: string) => string });
    setOptions(options: {
      modelComplexity?: number;
      smoothLandmarks?: boolean;
      enableSegmentation?: boolean;
      smoothSegmentation?: boolean;
      minDetectionConfidence?: number;
      minTrackingConfidence?: number;
    }): void;
    onResults(callback: (results: {
      poseLandmarks: Array<{
        x: number;
        y: number;
        z: number;
        visibility?: number;
      }>;
      image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
    }) => void): void;
    send(options: { image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement }): Promise<void>;
    close(): Promise<void>;
  }
}

declare module '@mediapipe/camera_utils' {
  export class Camera {
    constructor(
      videoElement: HTMLVideoElement,
      options?: {
        onFrame?: () => Promise<void>;
        width?: number;
        height?: number;
        facingMode?: string;
      }
    );
    start(): Promise<void>;
    stop(): void;
  }
}
