import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const getUser = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch (error) {
    console.error('Error fetching user:', error);
    return null;
  }
};

export const subscribeToAuthChanges = (callback: (event: any, session: any) => void) => {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
};

export const signOut = async () => {
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error('Error signing out:', error);
    throw error;
  }
};

export const uploadVideo = async (file: File, userId: string) => {
  const filePath = `videos/${userId}/${Date.now()}-${file.name}`;
  
  try {
    const { data, error } = await supabase.storage
      .from('videos')
      .upload(filePath, file);
      
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error uploading video:', error);
    throw error;
  }
};

export const saveLandmarkData = async (videoId: string, landmarkData: any) => {
  try {
    const { data, error } = await supabase
      .from('landmarks')
      .insert([{ video_id: videoId, data: landmarkData }]);
      
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error saving landmark data:', error);
    throw error;
  }
};