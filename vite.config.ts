import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base: './' ให้ build ไปวางที่ path ไหนก็ได้ (เช่น GitHub Pages /music-cover/)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
