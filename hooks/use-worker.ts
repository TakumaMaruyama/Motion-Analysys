import { useState, useEffect, useCallback, useRef } from 'react';
import { WorkerManager, createWorkerManager } from '@/lib/worker-manager';

interface UseWorkerOptions {
  onError?: (error: any) => void;
  autoInitialize?: boolean;
}

interface WorkerState<ResponseType> {
  loading: boolean;
  error: any;
  result: ResponseType | null;
}

/**
 * WebWorkerを使用するためのカスタムフック
 * @param workerUrl WorkerのURL
 * @param options オプション設定
 * @returns Workerの状態と制御関数
 */
export function useWorker<
  RequestType extends { type: string },
  ResponseType extends { type: string; error?: any }
>(workerUrl: string, options: UseWorkerOptions = {}) {
  const { onError, autoInitialize = true } = options;
  
  // WorkerManagerのインスタンスを保持するRef
  const workerManagerRef = useRef<WorkerManager<RequestType, ResponseType> | null>(null);
  
  // 状態管理
  const [state, setState] = useState<WorkerState<ResponseType>>({
    loading: false,
    error: null,
    result: null
  });
  
  // Workerの初期化
  const initialize = useCallback(async () => {
    try {
      // 既存のワーカーをクリーンアップ
      if (workerManagerRef.current) {
        workerManagerRef.current.terminate();
      }
      
      // 新しいワーカーマネージャーを作成
      const manager = createWorkerManager<RequestType, ResponseType>(workerUrl);
      workerManagerRef.current = manager;
      
      // エラーハンドラを設定
      if (onError) {
        manager.setErrorHandler(onError);
      }
      
      // 初期化
      await manager.initialize();
      
      return true;
    } catch (error) {
      setState(prev => ({ ...prev, error }));
      if (onError) {
        onError(error);
      }
      return false;
    }
  }, [workerUrl, onError]);
  
  // リクエストの送信
  const sendMessage = useCallback(async (message: RequestType) => {
    if (!workerManagerRef.current) {
      // ワーカーが初期化されていない場合は初期化を試みる
      const initialized = await initialize();
      if (!initialized) {
        throw new Error('Failed to initialize worker');
      }
    }
    
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      // メッセージを送信
      const result = await workerManagerRef.current!.postMessage(message);
      
      // 結果を保存
      setState(prev => ({ ...prev, loading: false, result }));
      
      return result;
    } catch (error) {
      setState(prev => ({ ...prev, loading: false, error }));
      if (onError) {
        onError(error);
      }
      throw error;
    }
  }, [initialize, onError]);
  
  // ワーカーの終了
  const terminate = useCallback(() => {
    if (workerManagerRef.current) {
      workerManagerRef.current.terminate();
      workerManagerRef.current = null;
    }
  }, []);
  
  // コンポーネントマウント時に初期化
  useEffect(() => {
    if (autoInitialize) {
      initialize();
    }
    
    // クリーンアップ時にワーカーを終了
    return () => {
      terminate();
    };
  }, [autoInitialize, initialize, terminate]);
  
  return {
    ...state,
    initialize,
    sendMessage,
    terminate
  };
} 