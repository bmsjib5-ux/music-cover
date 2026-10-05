-- ร้องเลย: ตั้งค่าระบบแข่งร้องข้ามเครื่อง
-- วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์นี้ → Run (รันซ้ำได้ ไม่พัง)
--
-- ห้องแข่งใช้ Realtime (broadcast + presence) ซึ่งไม่ต้องสร้างตาราง
-- ไฟล์นี้สร้างเฉพาะที่เก็บไฟล์เพลงชั่วคราวของห้อง และสิทธิ์การใช้งาน

-- 1) ที่เก็บไฟล์เพลงของห้อง: อ่านได้สาธารณะ, จำกัดไฟล์ละ 25 MB และเฉพาะไฟล์เสียง
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'battle-songs',
  'battle-songs',
  true,
  26214400,
  array[
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
    'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm',
    'audio/flac', 'audio/x-flac'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 2) สิทธิ์: ผู้เข้าเว็บ (anon) อัปโหลด/อ่าน/ลบไฟล์ได้เฉพาะในโฟลเดอร์ rooms/
--    (โฮสต์ลบไฟล์เมื่อออกจากห้อง และเว็บจะลบไฟล์ของห้องที่เก่ากว่า 1 วันให้อัตโนมัติ)
drop policy if exists "rongloei battle upload" on storage.objects;
create policy "rongloei battle upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'battle-songs' and (storage.foldername(name))[1] = 'rooms');

drop policy if exists "rongloei battle read" on storage.objects;
create policy "rongloei battle read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'battle-songs');

drop policy if exists "rongloei battle delete" on storage.objects;
create policy "rongloei battle delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'battle-songs' and (storage.foldername(name))[1] = 'rooms');
