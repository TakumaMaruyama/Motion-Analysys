import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface UploadVideoButtonProps {
  onUploadComplete?: () => void;
}

const UploadVideoButton: React.FC<UploadVideoButtonProps> = ({ onUploadComplete }) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('video', file);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/process-video');
      
      xhr.upload.addEventListener('progress', (progressEvent) => {
        if (progressEvent.lengthComputable) {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setProgress(percentCompleted);
        }
      });
      
      xhr.onload = async () => {
        if (xhr.status === 200) {
          if (onUploadComplete) {
            onUploadComplete();
          }
        } else {
          console.error('アップロードに失敗しました');
        }
        setUploading(false);
        setProgress(0);
      };
      
      xhr.onerror = () => {
        console.error('Error uploading video');
        setUploading(false);
        setProgress(0);
      };
      
      xhr.send(formData);
    } catch (error) {
      console.error('Error uploading video:', error);
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 bg-[#ffffff] dark:bg-[#1a1a1a] rounded-lg shadow">
      <div className="space-y-4">
        <Label htmlFor="video-upload" className="text-[#333333] dark:text-[#ffffff]">
          動画をアップロード
        </Label>
        
        <div className="flex items-center gap-4">
          <input
            id="video-upload"
            type="file"
            accept="video/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          
          <Button
            onClick={() => document.getElementById('video-upload')?.click()}
            disabled={uploading}
            className="w-full bg-[#4a90e2] hover:bg-[#357abd] text-white"
          >
            {uploading ? '処理中...' : '動画を選択'}
          </Button>
        </div>

        {uploading && (
          <div className="space-y-2">
            <div className="h-2 w-full bg-[#e0e0e0] rounded-full">
              <div
                className="h-full bg-[#4a90e2] rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-center text-[#666666] dark:text-[#cccccc]">
              {progress}% 完了
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default UploadVideoButton;
