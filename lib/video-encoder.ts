import { ProcessedFrame } from '@/types/motion';

/**
 * エンコード設定オプション
 */
export interface VideoEncoderOptions {
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  codec: string;
  hardwareAcceleration?: 'prefer-hardware' | 'prefer-software' | 'no-preference';
  alpha?: 'keep' | 'discard';
  latencyMode?: 'quality' | 'realtime';
}

/**
 * エンコード進捗コールバック
 */
export interface ProgressCallback {
  (progress: number, stats?: { framesProcessed: number; totalFrames: number }): void;
}

/**
 * WebCodecs APIを使用したビデオエンコーダ
 */
export class VideoEncoderService {
  // WebCodecs APIのサポート確認
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 
           'VideoEncoder' in window &&
           'VideoFrame' in window;
  }
  
  /**
   * フレームデータを動画ファイルにエンコード
   * @param frames 処理済みフレーム配列
   * @param options エンコード設定
   * @param onProgress 進捗コールバック
   * @returns エンコードされた動画のBlob
   */
  static async encodeFramesToVideo(
    frames: ProcessedFrame[],
    options: VideoEncoderOptions,
    onProgress?: ProgressCallback
  ): Promise<Blob> {
    // MP4エンコードを優先して実行
    try {
      return await this.encodeToMP4(frames, options, onProgress);
    } catch (error) {
      console.warn('MP4エンコードに失敗しました。WebMにフォールバックします。', error);
      return await this.encodeToWebM(frames, options, onProgress);
    }
  }

  /**
   * WebM形式でエンコード
   */
  static async encodeToWebM(
    frames: ProcessedFrame[],
    options: VideoEncoderOptions,
    onProgress?: ProgressCallback
  ): Promise<Blob> {
    // WebCodecs APIのサポート確認
    if (!this.isSupported()) {
      throw new Error('VideoEncoder API is not supported in this browser');
    }
    
    // フレームは時間順にソート
    const sortedFrames = [...frames].sort((a, b) => a.timestamp - b.timestamp);
    if (sortedFrames.length === 0) {
      throw new Error('No frames to encode');
    }
    
    // 変数の準備
    const totalFrames = sortedFrames.length;
    const duration = (sortedFrames[totalFrames - 1].timestamp - sortedFrames[0].timestamp) / 1000;
    const frameRate = options.frameRate || Math.round(totalFrames / duration) || 30;
    
    // フラグメントを格納する配列
    const chunks: Uint8Array[] = [];
    
    // エンコーダー設定
    const encoderConfig: VideoEncoderConfig = {
      codec: options.codec || 'vp09.00.10.08',
      width: options.width,
      height: options.height,
      bitrate: options.bitrate || 5_000_000, // 5Mbps
      framerate: frameRate,
      latencyMode: options.latencyMode === 'realtime' ? 'realtime' : 'quality',
      alpha: options.alpha === 'keep' ? 'keep' : 'discard',
      hardwareAcceleration: options.hardwareAcceleration || 'prefer-hardware'
    };
    
    // Promiseを作成
    return new Promise((resolve, reject) => {
      let framesProcessed = 0;
      
      // エンコーダーの作成
      const encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          // エンコードされたチャンクを保存
          const chunkData = new Uint8Array(chunk.byteLength);
          chunk.copyTo(chunkData);
          chunks.push(chunkData);
        },
        error: (error) => {
          reject(error);
        }
      });
      
      // エンコーダーの設定
      encoder.configure(encoderConfig);
      
      // 各フレームを順番にエンコード
      const encodeNextFrame = async (index: number) => {
        if (index >= sortedFrames.length) {
          // すべてのフレームをエンコードしたら終了
          encoder.flush().then(() => {
            encoder.close();
            
            // 複数のチャンクを結合
            const totalSize = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
            const videoBuffer = new Uint8Array(totalSize);
            
            let offset = 0;
            for (const chunk of chunks) {
              videoBuffer.set(chunk, offset);
              offset += chunk.byteLength;
            }
            
            // WebM形式として出力
            const blob = new Blob([videoBuffer], { type: 'video/webm' });
            resolve(blob);
          });
          return;
        }
        
        // 現在のフレームを取得
        const frame = sortedFrames[index];
        
        try {
          // ImageDataからBitmapを作成（非同期）
          const imageBitmap = await createImageBitmap(frame.imageData);
          
          // BitmapからVideoFrameを作成
          const videoFrame = new VideoFrame(
            imageBitmap, 
            {
              timestamp: Math.round(frame.timestamp * 1000), // マイクロ秒単位
              duration: Math.round(1000000 / frameRate) // マイクロ秒単位のフレーム持続時間
            }
          );
          
          // キーフレームの設定（30フレームごと）
          const keyFrame = index % 30 === 0;
          
          // エンコード
          encoder.encode(videoFrame, { keyFrame });
          videoFrame.close();
          imageBitmap.close(); // Bitmapリソースも解放
          
          // 進捗更新
          framesProcessed++;
          if (onProgress) {
            onProgress(framesProcessed / totalFrames, {
              framesProcessed,
              totalFrames
            });
          }
          
          // 次のフレーム処理をスケジュール（負荷管理のため）
          if (index % 10 === 0) {
            setTimeout(() => encodeNextFrame(index + 1), 0);
          } else {
            encodeNextFrame(index + 1);
          }
        } catch (e) {
          reject(e);
        }
      };
      
      // エンコード開始
      encodeNextFrame(0);
    });
  }
  
  /**
   * MP4形式でエンコード
   */
  static async encodeToMP4(
    frames: ProcessedFrame[],
    options: VideoEncoderOptions,
    onProgress?: ProgressCallback
  ): Promise<Blob> {
    // WebCodecs APIのサポート確認
    if (!this.isSupported()) {
      throw new Error('VideoEncoder API is not supported in this browser');
    }
    
    // フレームは時間順にソート
    const sortedFrames = [...frames].sort((a, b) => a.timestamp - b.timestamp);
    if (sortedFrames.length === 0) {
      throw new Error('No frames to encode');
    }
    
    // 変数の準備
    const totalFrames = sortedFrames.length;
    const duration = (sortedFrames[totalFrames - 1].timestamp - sortedFrames[0].timestamp) / 1000;
    const frameRate = options.frameRate || Math.round(totalFrames / duration) || 30;
    
    // フラグメントを格納する配列
    const chunks: Uint8Array[] = [];
    
    // エンコーダー設定（H.264を使用）
    const encoderConfig: VideoEncoderConfig = {
      codec: 'avc1.42001E', // H.264 Baseline Profile
      width: options.width,
      height: options.height,
      bitrate: options.bitrate || 5_000_000, // 5Mbps
      framerate: frameRate,
      latencyMode: options.latencyMode === 'realtime' ? 'realtime' : 'quality',
      alpha: 'discard', // MP4ではアルファチャンネルは通常サポートされない
      hardwareAcceleration: options.hardwareAcceleration || 'prefer-hardware'
    };
    
    // MP4フォーマットのサポートを確認
    try {
      const support = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!support.supported) {
        throw new Error('H.264エンコードがこのブラウザでサポートされていません');
      }
    } catch (error) {
      console.error('H.264サポート確認エラー:', error);
      throw error;
    }
    
    // Promiseを作成
    return new Promise((resolve, reject) => {
      let framesProcessed = 0;
      
      // エンコーダーの作成
      const encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          // エンコードされたチャンクを保存
          const chunkData = new Uint8Array(chunk.byteLength);
          chunk.copyTo(chunkData);
          chunks.push(chunkData);
        },
        error: (error) => {
          reject(error);
        }
      });
      
      // エンコーダーの設定
      encoder.configure(encoderConfig);
      
      // 各フレームを順番にエンコード
      const encodeNextFrame = async (index: number) => {
        if (index >= sortedFrames.length) {
          // すべてのフレームをエンコードしたら終了
          encoder.flush().then(() => {
            encoder.close();
            
            // 複数のチャンクを結合
            const totalSize = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
            const videoBuffer = new Uint8Array(totalSize);
            
            let offset = 0;
            for (const chunk of chunks) {
              videoBuffer.set(chunk, offset);
              offset += chunk.byteLength;
            }
            
            // MP4形式として出力
            const blob = new Blob([videoBuffer], { type: 'video/mp4' });
            resolve(blob);
          });
          return;
        }
        
        // 現在のフレームを取得
        const frame = sortedFrames[index];
        
        try {
          // ImageDataからBitmapを作成（非同期）
          const imageBitmap = await createImageBitmap(frame.imageData);
          
          // BitmapからVideoFrameを作成
          const videoFrame = new VideoFrame(
            imageBitmap, 
            {
              timestamp: Math.round(frame.timestamp * 1000), // マイクロ秒単位
              duration: Math.round(1000000 / frameRate) // マイクロ秒単位のフレーム持続時間
            }
          );
          
          // キーフレームの設定（15フレームごと - MP4ではより頻繁なキーフレームが有効）
          const keyFrame = index % 15 === 0;
          
          // エンコード
          encoder.encode(videoFrame, { keyFrame });
          videoFrame.close();
          imageBitmap.close(); // Bitmapリソースも解放
          
          // 進捗更新
          framesProcessed++;
          if (onProgress) {
            onProgress(framesProcessed / totalFrames, {
              framesProcessed,
              totalFrames
            });
          }
          
          // 次のフレーム処理をスケジュール（負荷管理のため）
          if (index % 10 === 0) {
            setTimeout(() => encodeNextFrame(index + 1), 0);
          } else {
            encodeNextFrame(index + 1);
          }
        } catch (e) {
          reject(e);
        }
      };
      
      // エンコード開始
      encodeNextFrame(0);
    });
  }
} 