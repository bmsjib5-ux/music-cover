/** ตั้งค่า Supabase ตอน build: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY */
export const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_ANON_KEY: string = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
export const SUPABASE_BUCKET = 'battle-songs';

export const supabaseConfigured = (): boolean => !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

/** โหมดทดสอบข้ามแท็บ (เฉพาะตอนพัฒนา): เปิด #/online?local */
export const localTransportAllowed = (): boolean => import.meta.env.DEV;
