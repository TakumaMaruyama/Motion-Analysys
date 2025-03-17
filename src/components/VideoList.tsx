// src/components/VideoList.tsx
import React from 'react';

interface VideoListProps {
  videos: any[]; // 適切な型に置き換えてください
}

const VideoList: React.FC<VideoListProps> = ({ videos }) => {
  return (
    <div>
      {videos.map((video) => (
        <div key={video.id}>{video.name}</div>
      ))}
    </div>
  );
};

export default VideoList;
