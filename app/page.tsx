import React from 'react';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import Link from 'next/link';

const Page: React.FC = () => {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <section className="text-center mb-16">
          <h1 className="text-4xl font-bold mb-4 text-[#2c3e50] dark:text-white">
            全身動作分析アプリ
          </h1>
          <p className="text-xl text-[#34495e] dark:text-gray-300 mb-8">
            動画から全身の動きを自動検出・分析
          </p>
          <video controls className="w-full max-w-2xl mx-auto rounded-lg shadow-lg mb-8">
            <source src="src/public/videos/demo.mp4" type="video/mp4" />
            お使いのブラウザは動画再生に対応していません
          </video>
          <div className="flex justify-center gap-4">
            <Link href="/motion-analysis">
              <Button variant="default" size="lg">
                分析を始める
              </Button>
            </Link>
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-8 mb-16">
          <Card className="bg-card">
            <CardHeader>
              <CardTitle>簡単アップロード</CardTitle>
            </CardHeader>
            <CardContent>
              <p>動画を選択するだけで自動的に分析を開始します</p>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardHeader>
              <CardTitle>高精度な分析</CardTitle>
            </CardHeader>
            <CardContent>
              <p>MediaPipe Poseによる高精度な全身動作の検出と追跡</p>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardHeader>
              <CardTitle>結果の可視化</CardTitle>
            </CardHeader>
            <CardContent>
              <p>骨格ラインとランドマークで動きを可視化</p>
            </CardContent>
          </Card>
        </section>

        <section className="text-center">
          <h2 className="text-3xl font-bold mb-8 text-[#2c3e50] dark:text-white">
            さっそく始めましょう
          </h2>
          <Link href="/motion-analysis">
            <Button variant="default" size="lg">
              分析を始める
            </Button>
          </Link>
        </section>
      </div>
    </div>
  );
};

export default Page;