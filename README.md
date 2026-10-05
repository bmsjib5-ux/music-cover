# 🎤 ร้องเลย — เว็บคาราโอเกะเพลงไทย

เว็บคาราโอเกะที่ทำงานในเบราว์เซอร์ทั้งหมด ไม่ต้องมีเซิร์ฟเวอร์ ไฟล์เพลงของผู้ใช้ไม่ถูกส่งขึ้นที่ใด

## ฟีเจอร์

**ทำเพลงคาราโอเกะเอง**
- อัปโหลดไฟล์เพลง (MP3 / M4A / WAV / OGG / FLAC) — ระบบวิเคราะห์ความยาว, waveform, ตรวจว่าเป็นสเตอริโอ และ**ประมาณคีย์เพลง**ให้อัตโนมัติ
- ใส่เนื้อเพลง: วางเอง, นำเข้าไฟล์ `.lrc`/`.txt` หรือ**ค้นจาก [LRCLIB](https://lrclib.net)** (บางเพลงไทยมีเวลาซิงก์มาให้แล้ว)
- **ซิงก์เนื้อแบบแตะ**: กด <kbd>Space</kbd> ค้างไว้ตอนเริ่มร้องแต่ละท่อน ปล่อยเมื่อจบท่อน (มือถือใช้ปุ่มใหญ่แทน) ปรับละเอียดทีละ 0.1 วิ, ลดความเร็วเพลงตอนซิงก์ได้, บันทึกอัตโนมัติ
- ส่งออกไฟล์ `.lrc`

**ร้องคาราโอเกะ**
- เนื้อเพลง**ไล่สีแบบตู้คาราโอเกะ** 2 บรรทัดสลับ (หรือแบบเลื่อน) — ตัดคำไทยด้วย `Intl.Segmenter` ไม่แยกสระ/วรรณยุกต์ออกจากพยัญชนะ, นับถอยหลังก่อนเข้าท่อน, แสดง "♪ ดนตรี ♪" ช่วงอินโทร/โซโล่
- **ตัดเสียงร้อง** (ปรับได้ 0–100%)
- **ปรับคีย์** ±7 ครึ่งเสียง โดยความเร็วไม่เปลี่ยน
- **ปรับความเร็ว** 50–150% โดยคีย์ไม่เปลี่ยน (เนื้อเพลงยังตรงจังหวะ)
- เลื่อนเวลาเนื้อทั้งเพลง, เต็มจอ, คีย์ลัด (<kbd>Space</kbd> เล่น/หยุด, <kbd>←</kbd>/<kbd>→</kbd>, <kbd>F</kbd> เต็มจอ)

**ไมค์ & เอฟเฟกต์ & อัดคัฟเวอร์**
- **Auto-Tune เรียลไทม์**: ปรับความแรง, สไตล์ (ธรรมชาติ ↔ หุ่นยนต์), สเกลโน้ต (ทุกโน้ต / ตามคีย์เพลงที่เลื่อนตามการปรับคีย์ / เลือกเอง) พร้อมจอบอกโน้ตที่ร้องและเพี้ยนกี่เซ็นต์
- เสียงก้อง (Reverb), เอคโค่, ได้ยินเสียงตัวเอง (ใส่หูฟัง), ระดับไมค์
- **อัดคัฟเวอร์**: รวมดนตรี (ตามคีย์/ความเร็ว/การตัดเสียงร้อง) + เสียงร้องพร้อมเอฟเฟกต์ ชดเชยความหน่วงไมค์ได้ ดาวน์โหลดเป็น WebM/M4A หรือ WAV

**ห้องคาราโอเกะ (คิวเพลง)**
- ต่อคิวเพลงจากคลังในเครื่อง**และ YouTube** ปะปนกัน เพลงจบเล่นเพลงถัดไปอัตโนมัติ, ข้าม/เลื่อน/ลบคิวได้
- วางลิงก์ YouTube ได้ทุกรูปแบบ หรือค้นหาในหน้าเว็บด้วย YouTube Data API — ฝัง key ไว้ตอน build ให้ทุกคนค้นได้ทันที (`VITE_YT_API_KEY`) หรือให้ผู้ใช้ใส่ key ของตัวเอง ผลค้นหาถูกจำไว้ 1 วันเพื่อประหยัดโควตา และถ้าโควตาหมดจะมีปุ่มไปค้นบน YouTube แทน
- คิวซิงก์ข้ามแท็บ — เปิดจอใหญ่ไว้แท็บหนึ่ง แล้วเลือกเพลงจากอีกแท็บได้
- วิดีโอ YouTube ปรับความเร็วได้ และร้องทับด้วยไมค์ + Auto-Tune ได้ (ปรับคีย์/ตัดเสียงร้องไม่ได้ เพราะเบราว์เซอร์ไม่ให้เข้าถึงเสียงของ YouTube)

มี**เพลงตัวอย่าง**ที่สังเคราะห์ขึ้นในเบราว์เซอร์ (เนื้อร้องแต่งใหม่ ไม่ติดลิขสิทธิ์) ให้ลองทุกฟีเจอร์ได้ทันทีตั้งแต่เปิดครั้งแรก

## เริ่มใช้งาน

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (DSP, LRC, ตัดคำไทย, ฯลฯ)
npm run build      # ได้ไฟล์ static ใน dist/
```

> ไมโครโฟน, Auto-Tune และการปรับคีย์ต้องเปิดผ่าน **https** หรือ `localhost` (ข้อกำหนดของเบราว์เซอร์)

### Deploy บน Render (static site ฟรี)
repo มีไฟล์ `render.yaml` ไว้แล้ว
1. เข้า [Render Dashboard](https://dashboard.render.com) → **New → Blueprint**
2. เชื่อม GitHub แล้วเลือก repo `music-cover` และ branch ที่ต้องการ
3. กด **Apply** — Render จะรัน `npm ci && npm run build` แล้วเสิร์ฟโฟลเดอร์ `dist/` ให้ (มี https ในตัว ไมค์/Auto-Tune ใช้ได้)

หรือสร้างเองแบบ **New → Static Site**: Build Command `npm ci && npm run build`, Publish Directory `dist`

**ให้ทุกคนค้นหา YouTube ได้ทันที:** ใน Render → service → **Environment** เพิ่มตัวแปร `VITE_YT_API_KEY` = API key ของ YouTube Data API v3 แล้วกด **Save, rebuild, and deploy** (ค่าถูกฝังตอน build จึงต้อง build ใหม่ทุกครั้งที่เปลี่ยน key)
> key จะมองเห็นได้ในไฟล์ JS ของเว็บ — ต้องตั้ง *Application restrictions → Websites* ให้ใช้ได้เฉพาะโดเมนของคุณ และ *API restrictions* เฉพาะ YouTube Data API v3 · โควตาฟรีวันละ 10,000 หน่วย (ค้นหาได้ ~100 ครั้ง/วัน ใช้ร่วมกันทุกคน)

### Deploy ฟรีบน GitHub Pages
1. Settings → Pages → Build and deployment → Source: **GitHub Actions**
2. push ขึ้น `main` — workflow `.github/workflows/deploy.yml` จะ build และ deploy ให้

build ใช้ `base: './'` จึงวางไว้ที่ path ไหนก็ได้ (Vercel, Netlify, Cloudflare Pages ก็ได้) และใช้ hash routing ไม่ต้องตั้งค่า rewrite

## เทคนิคเบื้องหลัง

| ส่วน | วิธีการ |
|---|---|
| ตัดเสียงร้อง | ซ้าย − ขวา (หักล้างเสียงที่อยู่ตรงกลาง) แล้วเติมย่าน < 160 Hz ของต้นฉบับกลับ เพื่อเก็บเบส/กลองกระเดื่องไว้ — ทำงานได้ดีกับเพลงที่มิกซ์เสียงร้องไว้ตรงกลาง ไฟล์โมโนตัดไม่ได้ |
| ปรับคีย์ | Phase vocoder (FFT 2048, overlap 4×) แบบ peak-locked (Laroche–Dolson) ใน AudioWorklet — ย้ายทั้งก้อนสเปกตรัมรอบ peak พร้อมล็อกเฟส ความดังคงที่ ไม่วูบวาบ |
| ปรับความเร็ว | `playbackRate` + `preservesPitch` ของเบราว์เซอร์ |
| Auto-Tune | ตรวจระดับเสียงด้วย YIN (ลด sample rate ครึ่งหนึ่ง) → หาโน้ตเป้าหมาย (มี hysteresis) → เปลี่ยนระดับเสียงด้วย delay line ที่กระโดดทีละรอบคลื่น (pitch-synchronous) หน่วงต่ำ ~5–20 ms |
| ตรวจคีย์เพลง | Chromagram + โปรไฟล์คีย์ Krumhansl–Kessler (แม่นราว 70–80% แก้เองได้ในหน้าแก้ไขเพลง) |
| เนื้อไล่สี | ตัดคำด้วย `Intl.Segmenter('th')` แต่ละคำใช้ `linear-gradient` + `background-clip: text` จึงไม่ทำให้สระลอย และไล่สีถูกแม้บรรทัดตัดขึ้นใหม่ |
| เก็บข้อมูล | IndexedDB (เพลง, คัฟเวอร์) + localStorage (คิว, การตั้งค่า) |

โครงสร้างโค้ด:

```
src/
  audio/
    engine.ts          เอนจินเสียงหลัก (กราฟ Web Audio, ไมค์, อัดเสียง)
    worklet.ts         AudioWorklet processors (pitch-shift, autotune)
    dsp/               FFT, phase vocoder, auto-tune (ทดสอบด้วย vitest)
  lib/                 LRC, ซิงก์เวลา, ตัดคำไทย, IndexedDB, LRCLIB, YouTube, คิว, เพลงตัวอย่าง
  components/          เครื่องเล่นคาราโอเกะ, เนื้อไล่สี, แผงไมค์, waveform, YouTube player
  pages/               คลังเพลง, เพิ่ม/แก้เพลง, ซิงก์เนื้อ, ร้อง, ห้องคาราโอเกะ
```

## ข้อจำกัด & แผนต่อไป

- การตัดเสียงร้องแบบ L−R เป็นวิธีพื้นฐาน เสียงก้องของนักร้อง (reverb สเตอริโอ) จะยังหลงเหลือบ้าง → **แผน**: ตัวเลือกแยกเสียงด้วย AI (Demucs/MDX ฝั่งเซิร์ฟเวอร์ หรือ ONNX ในเบราว์เซอร์)
- **แผน**: ใช้มือถือเป็นรีโมทผ่าน QR (ต้องมี realtime backend เช่น Supabase/Firebase)
- **แผน**: ให้คะแนนการร้องจากความตรงโน้ต, export วิดีโอคาราโอเกะ MP4, ไฮไลต์ทีละคำ (enhanced LRC)

## เว็บที่ใช้เป็นแรงบันดาลใจ

- ทำคาราโอเกะ: [Youka](https://www.youka.io/karaoke-maker), [Vocal Remover – Karaoke Maker](https://vocalremover.com/karaoke-maker), [Karadeo](https://karadeo.com/karaoke-maker), [MyKaraoke Video](https://www.mykaraoke.video/)
- คาราโอเกะเพลงไทย: [Thai2Karaoke](https://www.thai2karaoke.com/), [YouOke](https://okeforyou.com/), [Sing a Song](https://singasong.co/), [แหกปาก](https://haekpak.fun/)
- Open source: [LRCGen](https://github.com/final-wav/LRCGen), [Moseca](https://github.com/fabiogra/moseca), [OpenKara](https://github.com/thedavidweng/OpenKara)

โปรดใช้เพลงที่คุณมีสิทธิ์ใช้งาน
