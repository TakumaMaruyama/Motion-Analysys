import React from 'react';
import { MotionAnalyzer } from '@/components/motion-analyzer';

export default function MotionAnalysisPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6 text-center">モーションビジョン</h1>
      <p className="text-lg text-center mb-8">
        動画をアップロードして、全身の動きを分析します。
        骨格ラインとランドマークで動作を可視化し、
        フレームごとの姿勢データを取得できます。
      </p>
      
      <div className="max-w-4xl mx-auto">
        <MotionAnalyzer />
      </div>
    </div>
  );
}
