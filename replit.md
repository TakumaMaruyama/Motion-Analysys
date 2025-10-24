# Motion Analysis App

## Project Overview
A Next.js-based motion analysis application that uses MediaPipe and TensorFlow.js to analyze movement from camera feeds and uploaded videos.

## Recent Changes

### 2025-10-24: Vercel to Replit Migration
- **Port Configuration**: Updated to use port 5000 with 0.0.0.0 binding for Replit compatibility
- **Supabase Optional**: Implemented local storage adapter pattern to make Supabase credentials optional
- **Storage Mode**: 
  - When Supabase credentials are provided: Uses Supabase for video uploads and data persistence
  - Without Supabase: Uses in-memory storage (data persists during session but resets on server restart)
- **Auth Handling**: Auth UI components automatically hide when Supabase is disabled
- **Dark Mode Fix**: Added suppressHydrationWarning to resolve next-themes hydration warnings

## Project Architecture

### Key Technologies
- **Frontend**: Next.js 14 (App Router), React, TailwindCSS
- **Motion Analysis**: MediaPipe, TensorFlow.js
- **Video Processing**: FFmpeg (WebAssembly)
- **State Management**: Zustand
- **UI Components**: Radix UI
- **Theme**: next-themes for dark mode

### Storage Architecture
The app uses an adapter pattern for storage (`lib/storage-adapter.ts`):
- Checks for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` environment variables
- **If present**: Uses Supabase client for persistent cloud storage
- **If absent**: Uses in-memory storage with the same API surface

**Important Storage Limitations**:
- **In-memory mode** (no Supabase): Data is stored in memory during your development session
  - Video uploads and landmark data persist during the session
  - Data is lost when the server restarts or the Repl stops
  - Suitable for: Development, testing, and real-time camera analysis (which doesn't need persistence)
  
- **For production with persistent storage**, you have two options:
  1. Add Supabase credentials via Replit Secrets (recommended for production)
  2. Request integration of Replit PostgreSQL Database for video metadata storage

**Current Setup**: Running in in-memory mode. The core motion analysis features work fully - you can analyze videos from camera or uploads in real-time.

### Core Features
- **Real-time Camera Analysis**: Analyze body movements using device camera
- **Video Upload Analysis**: Upload and analyze pre-recorded videos
- **Motion Tracking**: Track body landmarks and movement patterns
- **Dashboard**: View analysis history and results

## Development

### Running Locally
The app runs automatically via the configured workflow on port 5000.

### Environment Variables (Optional)
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anonymous key

If not provided, the app runs in local/development mode with in-memory storage.

## Deployment
Configured for Replit Autoscale deployment:
- Build command: `npm run build`
- Start command: `npm run start`
- Port: 5000
