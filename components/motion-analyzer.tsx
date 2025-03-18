'use client';

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { processVideo } from '@/utils/processVideo';

export function MotionAnalyzer() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [processedVideoUrl, setProcessedVideoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 動画ファイルが選択されたときの処理
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setError('動画ファイルを選択してください');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProgress('動画を処理中...');
    
    try {
      const result = await processVideo(file);
      setProcessedVideoUrl(result.processedUrl);
      setProgress('処理完了');
    } catch (err) {
      console.error('Video processing error:', err);
      setError('動画の処理中にエラーが発生しました');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-4">
          {!isProcessing && !processedVideoUrl && (
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
          )}

          {isProcessing && (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-lg">{progress}</p>
            </div>
          )}

          {error && (
            <div className="text-center text-red-500 py-4">
              {error}
            </div>
          )}

          {processedVideoUrl && (
            <div className="space-y-4">
              <video 
                src={processedVideoUrl} 
                controls 
                className="w-full rounded-lg"
              />
              <div className="flex justify-center gap-4">
                <Button
                  onClick={() => window.open(processedVideoUrl, '_blank')}
                  variant="outline"
                >
                  新しいタブで開く
                </Button>
                <Button
                  onClick={() => {
                    setProcessedVideoUrl(null);
                    setProgress('');
                  }}
                >
                  別の動画を分析
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
