/** แปลง AudioBuffer เป็นไฟล์ WAV 16-bit (normalize ให้ดังพอดีถ้าต้องการ) */
export function encodeWav(buffer: AudioBuffer, normalize = false): Blob {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const data: Float32Array[] = [];
  let peak = 0;
  for (let c = 0; c < channels; c++) {
    const d = buffer.getChannelData(c);
    data.push(d);
    if (normalize) for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const gain = normalize && peak > 0 ? 0.89 / peak : 1;
  const bytes = length * channels * 2;
  const ab = new ArrayBuffer(44 + bytes);
  const v = new DataView(ab);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i] * gain));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

/** ถอดรหัสไฟล์เสียงใดๆ ที่เบราว์เซอร์รองรับ แล้วแปลงเป็น WAV */
export async function toWav(blob: Blob): Promise<Blob> {
  const buf = await decodeBlob(blob);
  return encodeWav(buf);
}

export async function decodeBlob(blob: Blob, sampleRate = 44100): Promise<AudioBuffer> {
  const ab = await blob.arrayBuffer();
  const OAC: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OAC(2, 1, sampleRate);
  return await new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(ab, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}
