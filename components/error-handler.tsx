import React from 'react';
import { Button } from '@/components/ui/button';

interface ErrorHandlerProps {
  error: string;
  onClear: () => void;
}

/**
 * エラーメッセージを表示するコンポーネント
 * エラー表示とクリアボタンを提供します
 */
export const ErrorDisplay = ({ error, onClear }: ErrorHandlerProps) => {
  if (!error) return null;
  
  return (
    <div className="text-center text-red-500 py-4">
      <p>{error}</p>
      <Button 
        onClick={onClear} 
        className="mt-4"
        variant="outline"
      >
        再試行
      </Button>
    </div>
  );
};

/**
 * エラー処理のためのヘルパー関数
 * @param setError エラー状態を設定する関数
 */
export const createErrorHandler = (setError: React.Dispatch<React.SetStateAction<string>>) => {
  // エラー表示のリセット
  const clearError = () => setError('');
  
  // エラー設定処理
  const handleError = (err: unknown) => {
    if (err instanceof Error) {
      setError(err.message);
    } else if (typeof err === 'string') {
      setError(err);
    } else {
      setError('不明なエラーが発生しました');
    }
  };
  
  return {
    clearError,
    handleError
  };
}; 