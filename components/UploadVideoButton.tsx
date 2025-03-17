// src/components/UploadVideoButton.tsx
import React from 'react';
import { Button } from '@/components/ui/button';

interface UploadVideoButtonProps {
  onUploadComplete?: () => void;
}

const UploadVideoButton: React.FC<UploadVideoButtonProps> = ({ onUploadComplete }) => {
  const handleUpload = () => {
    // Upload logic here
    if (onUploadComplete) {
      onUploadComplete();
    }
  };

  return (
    <Button onClick={handleUpload} variant="default">
      Upload Video
    </Button>
  );
};

export default UploadVideoButton;