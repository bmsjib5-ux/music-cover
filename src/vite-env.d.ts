/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** YouTube Data API key ที่ฝังตอน build (ไม่บังคับ) */
  readonly VITE_YT_API_KEY?: string;
  /** Supabase สำหรับแข่งร้องข้ามเครื่อง (ไม่บังคับ) */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
