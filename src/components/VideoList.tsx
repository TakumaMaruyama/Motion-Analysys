// src/components/VideoList.tsx
import React from 'react';
import { Video } from '@/types/video';

interface VideoListProps {
  videos: Video[];
}

const VideoList: React.FC<VideoListProps> = ({ videos }) => {
  return (
    <div className="w-full bg-white dark:bg-gray-800 p-4">
      <div className="rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="p-4 text-left">サムネイル</th>
              <th className="p-4 text-left">タイトル</th>
              <th className="p-4 text-left">アップロード日時</th>
              <th className="p-4 text-left">動画</th>
              <th className="p-4 text-left">分析結果</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.id} className="border-b">
                <td className="p-4">
                  <img 
                    src={video.thumbnailUrl} 
                    alt={`${video.title}のサムネイル`}
                    className="w-24 h-24 object-cover rounded"
                  />
                </td>
                <td className="p-4">{video.title}</td>
                <td className="p-4">
                  {new Date(video.uploadedAt).toLocaleDateString('ja-JP')}
                </td>
                <td className="p-4">
                  <video controls className="w-48">
                    <source src={video.originalVideoUrl} type="video/mp4" />
                    お使いのブラウザは動画再生に対応していません
                  </video>
                </td>
                <td className="p-4">
                  <video controls className="w-48">
                    <source src={video.processedVideoUrl} type="video/mp4" />
                    お使いのブラウザは動画再生に対応していません
                  </video>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VideoList;
