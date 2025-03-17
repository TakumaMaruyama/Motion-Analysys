import React from 'react';

const HeroSection: React.FC = () => {
  return (
    <div className="w-full bg-white dark:bg-gray-800 py-16">
      <div className="max-w-3xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4 text-[#2c3e50] dark:text-[#ffffff]">
            ハンドジェスチャー分析で動画をもっと便利に
          </h1>
          <p className="text-xl mb-8 text-[#34495e] dark:text-[#e0e0e0]">
            MediaPipe Handsを使用して、あなたの動画から手の動きを自動検出・分析
          </p>
        </div>

        <div className="relative rounded-xl overflow-hidden mb-12">
          <video 
            controls 
            className="w-full rounded-xl shadow-lg"
          >
            <source src="src/public/videos/demo.mp4" type="video/mp4" />
            お使いのブラウザは動画再生に対応していません
          </video>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          <div className="p-6 bg-[#ffffff] dark:bg-[#1f2937] rounded-lg shadow-md">
            <h3 className="text-xl font-semibold mb-3 text-[#2c3e50] dark:text-[#ffffff]">
              簡単アップロード
            </h3>
            <p className="text-[#34495e] dark:text-[#e0e0e0]">
              動画をドラッグ＆ドロップするだけで分析開始
            </p>
          </div>

          <div className="p-6 bg-[#ffffff] dark:bg-[#1f2937] rounded-lg shadow-md">
            <h3 className="text-xl font-semibold mb-3 text-[#2c3e50] dark:text-[#ffffff]">
              高精度な検出
            </h3>
            <p className="text-[#34495e] dark:text-[#e0e0e0]">
              MediaPipe Handsによる正確なハンドトラッキング
            </p>
          </div>

          <div className="p-6 bg-[#ffffff] dark:bg-[#1f2937] rounded-lg shadow-md">
            <h3 className="text-xl font-semibold mb-3 text-[#2c3e50] dark:text-[#ffffff]">
              詳細な分析結果
            </h3>
            <p className="text-[#34495e] dark:text-[#e0e0e0]">
              ランドマーク付き動画で動きを可視化
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroSection;