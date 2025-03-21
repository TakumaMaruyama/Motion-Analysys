/**
 * WebWorkerの管理とライフサイクル処理を行うクラス
 */
export class WorkerManager<
  RequestType extends { type: string },
  ResponseType extends { type: string; error?: any }
> {
  private worker: Worker | null = null;
  private callbacks: Map<string, ((response: ResponseType) => void)[]> = new Map();
  private errorHandler: ((error: any) => void) | null = null;
  private workerUrl: string;
  
  /**
   * コンストラクタ
   * @param workerUrl WorkerのURL
   */
  constructor(workerUrl: string) {
    this.workerUrl = workerUrl;
  }
  
  /**
   * Workerを初期化
   */
  public initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // すでに存在する場合は終了
        if (this.worker) {
          this.terminate();
        }
        
        // 新しいWorkerを作成
        this.worker = new Worker(this.workerUrl);
        
        // メッセージハンドラを設定
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = (error) => {
          if (this.errorHandler) {
            this.errorHandler(error);
          }
          reject(error);
        };
        
        // 初期化成功
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Workerにメッセージを送信
   * @param message 送信するメッセージ
   * @returns レスポンスを含むPromise
   */
  public postMessage(message: RequestType): Promise<ResponseType> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker is not initialized'));
        return;
      }
      
      // レスポンスタイプに基づいてコールバックを登録
      const responseType = `${message.type}d`; // 例: request.type='init' → response.type='initialized'
      
      const callback = (response: ResponseType) => {
        // エラーがある場合は拒否
        if (response.error) {
          reject(response.error);
          return;
        }
        
        // 成功した場合は解決
        resolve(response);
      };
      
      // コールバックを追加
      if (!this.callbacks.has(responseType)) {
        this.callbacks.set(responseType, []);
      }
      this.callbacks.get(responseType)!.push(callback);
      
      // メッセージを送信
      this.worker.postMessage(message);
    });
  }
  
  /**
   * グローバルエラーハンドラを設定
   * @param handler エラーハンドラ関数
   */
  public setErrorHandler(handler: (error: any) => void): void {
    this.errorHandler = handler;
  }
  
  /**
   * Workerを終了
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    // コールバックをクリア
    this.callbacks.clear();
  }
  
  /**
   * Workerからのメッセージを処理
   * @param event メッセージイベント
   */
  private handleMessage(event: MessageEvent<ResponseType>): void {
    const response = event.data;
    const responseType = response.type;
    
    // 対応するコールバックを呼び出す
    if (this.callbacks.has(responseType)) {
      const callbacks = this.callbacks.get(responseType)!;
      
      // すべてのコールバックを呼び出し
      callbacks.forEach(callback => callback(response));
      
      // 使用済みのコールバックを削除
      this.callbacks.delete(responseType);
    }
    
    // エラーがある場合はグローバルハンドラを呼び出す
    if (response.error && this.errorHandler) {
      this.errorHandler(response.error);
    }
  }
}

/**
 * WorkerManagerのファクトリ関数
 * @param workerUrl WorkerのURL
 * @returns 初期化されたWorkerManager
 */
export function createWorkerManager<RequestType extends { type: string }, ResponseType extends { type: string; error?: any }>(
  workerUrl: string
): WorkerManager<RequestType, ResponseType> {
  return new WorkerManager<RequestType, ResponseType>(workerUrl);
} 