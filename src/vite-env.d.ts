/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** YouTube Data API key ที่ฝังตอน build (ไม่บังคับ) */
  readonly VITE_YT_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
