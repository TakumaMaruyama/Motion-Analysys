"use client";

import React from 'react';
import create from 'zustand';

interface VideoState {
  videos: Video[];
  setVideos: (videos: Video[]) => void;
  addVideo: (video: Video) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

interface Video {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  processedUrl: string;
  createdAt: string;
}

const useStore = create<VideoState>((set) => ({
  videos: [],
  setVideos: (videos) => set({ videos }),
  addVideo: (video) => set((state) => ({ videos: [...state.videos, video] })),
  loading: false,
  setLoading: (loading) => set({ loading }),
}));

const StateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div style={{ backgroundColor: '#ffffff', color: '#000000' }}>
      {children}
    </div>
  );
};

export { useStore };
export default StateProvider;