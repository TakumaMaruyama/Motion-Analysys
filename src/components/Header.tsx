import React, { useState, useEffect } from 'react';

const Header: React.FC = () => {
  const [user, setUser] = useState(null);

  return (
    <div className="w-full bg-[#ffffff] dark:bg-[#1a1a1a] border-b border-[#e5e5e5] dark:border-[#333333]">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <a href="/" className="flex items-center space-x-2">
              <img src="/src/public/images/logo.png" alt="アプリケーションロゴ" className="h-8 w-8" />
              <span className="text-[#333333] dark:text-[#ffffff] text-xl font-bold">ハンドジェスチャー分析</span>
            </a>
          </div>

          <nav className="hidden md:flex items-center space-x-6">
            <a href="/dashboard" className="text-[#333333] dark:text-[#ffffff] hover:text-[#666666] dark:hover:text-[#cccccc]">
              ダッシュボード
            </a>
            <a href="/analysis" className="text-[#333333] dark:text-[#ffffff] hover:text-[#666666] dark:hover:text-[#cccccc]">
              分析
            </a>
          </nav>

          <div className="flex items-center space-x-4">
            {user ? (
              <div className="flex items-center space-x-4">
                <Avatar>
                  <AvatarImage src={user.avatar_url} alt="ユーザーアバター" />
                  <AvatarFallback>UN</AvatarFallback>
                </Avatar>
                <Button variant="outline" onClick={() => {}}>
                  ログアウト
                </Button>
              </div>
            ) : (
              <Button onClick={() => {}}>
                ログイン
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Header;