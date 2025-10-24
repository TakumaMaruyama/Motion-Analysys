import { createClient } from '@supabase/supabase-js';

const hasSupabaseCredentials = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!(url && key && url.trim() !== '' && key.trim() !== '');
};

const createLocalStorageAdapter = () => {
  const inMemoryStore: { [key: string]: any[] } = {
    videos: [],
    landmarks: [],
  };

  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: (callback: any) => {
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async () => ({ error: null }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: File | Blob) => {
          console.log(`[Local Storage] Storing ${file instanceof File ? file.name : 'blob'} in memory at ${path}`);
          const videoEntry = {
            id: Date.now().toString(),
            path,
            name: file instanceof File ? file.name : 'video.mp4',
            size: file.size,
            type: file.type,
            uploadedAt: new Date().toISOString(),
          };
          
          if (!inMemoryStore.videos) {
            inMemoryStore.videos = [];
          }
          inMemoryStore.videos.push(videoEntry);
          
          return { data: { path, id: videoEntry.id }, error: null };
        },
        list: async (path?: string) => {
          console.log(`[Local Storage] Listing videos from ${path || 'root'}`);
          const videos = inMemoryStore.videos || [];
          return { 
            data: videos.map(v => ({ 
              name: v.name, 
              id: v.id,
              created_at: v.uploadedAt 
            })), 
            error: null 
          };
        },
        remove: async (paths: string[]) => {
          console.log(`[Local Storage] Removing ${paths.length} items`);
          return { data: paths, error: null };
        },
      }),
    },
    from: (table: string) => ({
      insert: async (data: any) => {
        console.log(`[Local Storage] Inserting into ${table}:`, data);
        
        if (!inMemoryStore[table]) {
          inMemoryStore[table] = [];
        }
        
        const records = Array.isArray(data) ? data : [data];
        const insertedRecords = records.map((record: any) => ({
          ...record,
          id: Date.now() + Math.random(),
          created_at: new Date().toISOString(),
        }));
        
        inMemoryStore[table].push(...insertedRecords);
        
        return { data: insertedRecords, error: null };
      },
      select: (columns?: string) => ({
        eq: (column: string, value: any) => ({
          data: (inMemoryStore[table] || []).filter((item: any) => item[column] === value),
          error: null,
        }),
        data: inMemoryStore[table] || [],
        error: null,
      }),
      delete: () => ({
        eq: (column: string, value: any) => {
          if (inMemoryStore[table]) {
            inMemoryStore[table] = inMemoryStore[table].filter(
              (item: any) => item[column] !== value
            );
          }
          return { data: null, error: null };
        },
      }),
    }),
  };
};

export const getStorageClient = () => {
  if (hasSupabaseCredentials()) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    return createClient(supabaseUrl, supabaseAnonKey);
  }
  
  return createLocalStorageAdapter() as any;
};

export const isSupabaseEnabled = () => hasSupabaseCredentials();
