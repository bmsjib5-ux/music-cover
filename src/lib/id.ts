/** ใช้ได้แม้ไม่ใช่ secure context (crypto.randomUUID ใช้ไม่ได้บน http ธรรมดา) */
export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
