import React from 'react';
import { MotionAnalyzer } from '../../components/motion-analyzer';

export default function MotionAnalysisPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6 text-center">全身動作分析</h1>
      <p className="text-lg text-center mb-8">
        動画をアップロードして、全身の動きを分析しましょう。
        ランドマーク付きの動画で動作の詳細を確認できます。
      </p>
      
      <div className="max-w-4xl mx-auto">
        <MotionAnalyzer />
      </div>
    </div>
  );
}
