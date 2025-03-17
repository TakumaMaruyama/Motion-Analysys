"use client";

import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="w-full bg-[#1a1a1a] text-[#ffffff] py-8">
      <div className="max-w-[800px] mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-semibold mb-4">ハンドジェスチャー分析</h3>
            <p className="text-sm text-[#cccccc]">
              動画からハンドジェスチャーを分析し、ランドマークを付与するサービスを提供しています。
            </p>
          </div>
          
          <div>
            <h3 className="text-lg font-semibold mb-4">リンク</h3>
            <ul className="space-y-2">
              <li>
                <a href="/privacy" className="text-sm text-[#cccccc] hover:text-[#ffffff] transition-colors">
                  プライバシーポリシー
                </a>
              </li>
              <li>
                <a href="/terms" className="text-sm text-[#cccccc] hover:text-[#ffffff] transition-colors">
                  利用規約
                </a>
              </li>
              <li>
                <a href="/contact" className="text-sm text-[#cccccc] hover:text-[#ffffff] transition-colors">
                  お問い合わせ
                </a>
              </li>
            </ul>
          </div>
          
          <div>
            <h3 className="text-lg font-semibold mb-4">お問い合わせ</h3>
            <p className="text-sm text-[#cccccc]">
              support@handgesture.jp<br />
              〒100-0001<br />
              東京都千代田区1-1-1
            </p>
          </div>
        </div>
        
        <hr className="my-6 border-[#333333]" />
        
        <div className="text-center text-sm text-[#cccccc]">
          2024 ハンドジェスチャー分析. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;