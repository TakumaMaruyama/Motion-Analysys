import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { Hands } from '@mediapipe/hands';
import * as ffmpeg from 'ffmpeg';
import { supabase } from '@/lib/supabase';
import { processVideo } from '@/utils/processVideo';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const videoFile = formData.get('video') as File;

    if (!videoFile) {
      return NextResponse.json({ error: '動画ファイルが見つかりません' }, { status: 400 });
    }

    // Supabaseに動画をアップロード
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('videos')
      .upload(`original/${Date.now()}-${videoFile.name}`, videoFile);

    if (uploadError) {
      return NextResponse.json({ error: 'アップロードに失敗しました' }, { status: 500 });
    }

    // 動画処理とランドマーク抽出
    const { processedVideoUrl, landmarks } = await processVideo(videoFile);

    // ランドマークデータをデータベースに保存
    const { error: dbError } = await supabase
      .from('landmarks')
      .insert({
        video_id: uploadData.path,
        landmarks: landmarks,
        created_at: new Date().toISOString()
      });

    if (dbError) {
      return NextResponse.json({ error: 'ランドマークの保存に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({
      originalVideo: uploadData.path,
      processedVideo: processedVideoUrl,
      landmarks: landmarks
    });

  } catch (error) {
    console.error('動画処理中にエラーが発生しました:', error);
    return NextResponse.json(
      { error: '動画の処理中にエラーが発生しました' },
      { status: 500 }
    );
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};