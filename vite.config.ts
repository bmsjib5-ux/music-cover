import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

// base: './' ให้ build ไปวางที่ path ไหนก็ได้ (เช่น GitHub Pages /music-cover/)
export default defineConfig(({ command }) => {
  if (command === 'build') {
    // บอกใน log ว่าฝัง YouTube API key หรือไม่ (ไม่แสดงตัว key)
    const key = env.VITE_YT_API_KEY?.trim() ?? '';
    const status = key
      ? `set (${key.length} chars${key.startsWith('AIza') ? '' : ', WARNING: does not start with "AIza"'})`
      : 'NOT SET — YouTube search will require each user to enter a key';
    console.log(`[rong-loei] VITE_YT_API_KEY: ${status}`);
    const sbUrl = env.VITE_SUPABASE_URL?.trim();
    const sbKey = env.VITE_SUPABASE_ANON_KEY?.trim();
    console.log(
      `[rong-loei] Supabase (online battle): ${
        sbUrl && sbKey ? `set (${sbUrl.replace(/^https?:\/\//, '').split('.')[0]}…)` : `NOT SET${sbUrl || sbKey ? ' — need both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY' : ''}`
      }`,
    );
  }
  return {
    base: './',
    plugins: [react()],
    test: {
      environment: 'node',
    },
  };
});
