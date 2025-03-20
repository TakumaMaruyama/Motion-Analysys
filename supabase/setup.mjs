import { createClient } from '@supabase/supabase-js';

// 直接Supabaseの接続情報を指定する
const supabaseUrl = "https://your-actual-supabase-url.supabase.co"; // 実際のURLに置き換えてください
const supabaseKey = "your-actual-supabase-key"; // 実際のキーに置き換えてください

console.log("Supabase URL:", supabaseUrl);
console.log("Supabase Key:", supabaseKey.substring(0, 5) + "..."); // セキュリティのため一部のみ表示

// Supabaseクライアントを作成
const supabase = createClient(supabaseUrl, supabaseKey);

// ストレージバケットの作成
const setupStorage = async () => {
  try {
    console.log("Supabaseクライアントを作成しました。バケットの作成を試みます...");
    
    // まずバケットのリストを取得して確認
    const { data: bucketList, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      console.error("バケットリストの取得に失敗しました:", listError);
      console.error("エラーの詳細:", JSON.stringify(listError, null, 2));
      return;
    }
    
    console.log("既存のバケット:", bucketList.map(b => b.name));
    
    // motion-videosバケットの作成
    console.log("'motion-videos'バケットの作成を試みます...");
    const { data: motionBucket, error: motionError } = await supabase.storage.createBucket('motion-videos', {
      public: false,
      allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
      fileSizeLimit: 50000000 // 50MB
    });

    if (motionError) {
      console.error("ストレージバケット 'motion-videos' の作成に失敗しました:", motionError.message);
      console.error("エラーの詳細:", JSON.stringify(motionError, null, 2));
    } else {
      console.log("ストレージバケット 'motion-videos' が作成されました:", motionBucket);
    }

    // processed-videosバケットの作成
    console.log("'processed-videos'バケットの作成を試みます...");
    const { data: processedBucket, error: processedError } = await supabase.storage.createBucket('processed-videos', {
      public: true,
      allowedMimeTypes: ['video/mp4', 'video/webm'],
      fileSizeLimit: 50000000 // 50MB
    });

    if (processedError) {
      console.error("ストレージバケット 'processed-videos' の作成に失敗しました:", processedError.message);
      console.error("エラーの詳細:", JSON.stringify(processedError, null, 2));
    } else {
      console.log("ストレージバケット 'processed-videos' が作成されました:", processedBucket);
    }
  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    console.error('エラーのスタックトレース:', error.stack);
  }
};

// ストレージのセットアップを実行
setupStorage().catch(error => {
  console.error('予期せぬエラーが発生しました:', error);
});