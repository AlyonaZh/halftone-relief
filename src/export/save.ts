// Имя файла и сохранение: на телефоне — через «Поделиться» (Web Share API), иначе обычное скачивание.

export function exportName(ext: string, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `halftone-relief-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

export async function saveBlob(blob: Blob, name: string): Promise<void> {
  if (isTouchDevice() && 'canShare' in navigator) {
    try {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
      /* падаем в обычное скачивание */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function pixelsToPng(px: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}
