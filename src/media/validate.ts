// Проверка и загрузка входных файлов (SPEC §5). Порядок: вес → метаданные → пробное декодирование.
import { LIMITS } from '../defaults';

export type FileKind = 'photo' | 'video' | 'audio';

export class MediaError extends Error {}

const EXT: Record<string, FileKind> = {
  png: 'photo', jpg: 'photo', jpeg: 'photo', webp: 'photo',
  mp4: 'video', m4v: 'video', webm: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', aac: 'audio',
};

export function detectKind(file: File): FileKind | null {
  const t = file.type.toLowerCase();
  if (/^image\/(png|jpe?g|webp)$/.test(t)) return 'photo';
  if (/^video\/(mp4|webm|quicktime|x-m4v)$/.test(t)) return 'video';
  if (/^audio\/(mpeg|mp3|wav|x-wav|wave|vnd\.wave|mp4|x-m4a|m4a|aac|ogg|opus|webm)$/.test(t)) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT[ext] ?? null;
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

export const MSG = {
  unsupported: 'Этот формат не поддерживается. Загрузите фото (PNG, JPG, WebP) или видео (MP4, WebM).',
  unsupportedAudio: 'Этот формат не поддерживается. Загрузите аудио (MP3, WAV, M4A, OGG).',
  videoDecode:
    'Браузер не может открыть это видео. Часто так бывает с MOV (HEVC) с iPhone — перекодируйте его в MP4 (H.264).',
  photoDecode: 'Браузер не может открыть это фото. Сохраните его как PNG или JPG и загрузите снова.',
  audioDecode: 'Браузер не может открыть этот аудиофайл. Перекодируйте его в MP3 или WAV.',
  size(bytes: number, kind: FileKind) {
    const lim = kind === 'video' ? LIMITS.videoMaxBytes : kind === 'photo' ? LIMITS.photoMaxBytes : LIMITS.audioMaxBytes;
    const name = kind === 'video' ? 'видео' : kind === 'photo' ? 'фото' : 'аудио';
    return `Файл весит ${mb(bytes)} МБ. Максимум для ${name} — ${mb(lim)} МБ.`;
  },
  videoRes(w: number, h: number) {
    let s = `Видео ${w} × ${h} — больше допустимого. Максимум 1920 × 1080 (или 1080 × 1920). Уменьшите видео и загрузите снова.`;
    if (Math.max(w, h) >= 3840) s += ' Снимите в 1080p или уменьшите видео.';
    return s;
  },
  photoRes(w: number, h: number) {
    return `Фото ${w} × ${h} — больше допустимого. Максимум 4096 px по каждой стороне.`;
  },
};

function checkWeight(file: File, kind: FileKind) {
  const lim = kind === 'video' ? LIMITS.videoMaxBytes : kind === 'photo' ? LIMITS.photoMaxBytes : LIMITS.audioMaxBytes;
  if (file.size > lim) throw new MediaError(MSG.size(file.size, kind));
}

function waitEvent(el: HTMLMediaElement, ok: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
      clearTimeout(timer);
      fn();
    };
    const onOk = () => done(resolve);
    const onErr = () => done(() => reject(new Error('media error')));
    const timer = setTimeout(() => done(() => reject(new Error('timeout'))), timeoutMs);
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
  });
}

export interface LoadedPhoto {
  kind: 'photo';
  el: HTMLImageElement;
  width: number;
  height: number;
  url: string;
}

export interface LoadedVideo {
  kind: 'video';
  el: HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
  url: string;
}

export interface LoadedAudio {
  kind: 'audio';
  el: HTMLAudioElement;
  duration: number;
  peaks: number[];
  name: string;
  url: string;
}

export async function loadPhoto(file: File): Promise<LoadedPhoto> {
  checkWeight(file, 'photo');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new MediaError(MSG.photoDecode);
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w > LIMITS.photoMaxSide || h > LIMITS.photoMaxSide) {
    URL.revokeObjectURL(url);
    throw new MediaError(MSG.photoRes(w, h));
  }
  if (!w || !h) {
    URL.revokeObjectURL(url);
    throw new MediaError(MSG.photoDecode);
  }
  return { kind: 'photo', el: img, width: w, height: h, url };
}

export async function loadVideo(file: File): Promise<LoadedVideo> {
  checkWeight(file, 'video');
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'auto';
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.crossOrigin = 'anonymous';
  v.src = url;
  const fail = (msg: string) => {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
    v.load();
    return new MediaError(msg);
  };
  try {
    await waitEvent(v, 'loadedmetadata');
  } catch {
    throw fail(MSG.videoDecode);
  }
  const w = v.videoWidth;
  const h = v.videoHeight;
  const fits =
    (w <= LIMITS.videoMaxLong && h <= LIMITS.videoMaxShort) || (w <= LIMITS.videoMaxShort && h <= LIMITS.videoMaxLong);
  if (w && h && !fits) throw fail(MSG.videoRes(w, h));
  // пробное декодирование первого кадра
  try {
    if (v.readyState < 2) await waitEvent(v, 'loadeddata');
  } catch {
    throw fail(MSG.videoDecode);
  }
  if (!v.videoWidth || !v.videoHeight) throw fail(MSG.videoDecode);
  // WebM из MediaRecorder часто не знает длительность — узнаём, перемотав в конец
  if (!Number.isFinite(v.duration)) {
    v.currentTime = 1e101;
    await waitEvent(v, 'durationchange', 5000).catch(() => {});
    v.currentTime = 0;
    await waitEvent(v, 'seeked', 5000).catch(() => {});
  }
  const hasAudio = await sniffAudioTrack(file, v);
  return {
    kind: 'video',
    el: v,
    width: v.videoWidth,
    height: v.videoHeight,
    duration: Number.isFinite(v.duration) ? v.duration : 0,
    hasAudio,
    url,
  };
}

export async function loadAudio(file: File): Promise<LoadedAudio> {
  checkWeight(file, 'audio');
  const url = URL.createObjectURL(file);
  const a = document.createElement('audio');
  a.preload = 'auto';
  a.src = url;
  try {
    await waitEvent(a, 'loadedmetadata');
  } catch {
    URL.revokeObjectURL(url);
    throw new MediaError(MSG.audioDecode);
  }
  let peaks: number[] = [];
  try {
    peaks = await computePeaks(file, 72);
  } catch {
    peaks = new Array(72).fill(0.3);
  }
  return { kind: 'audio', el: a, duration: a.duration, peaks, name: file.name, url };
}

/** Пики для волновой формы (раздел «Аудио») */
async function computePeaks(file: File, bars: number): Promise<number[]> {
  const buf = await file.arrayBuffer();
  const Ctx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, 44100);
  const audio: AudioBuffer = await new Promise((res, rej) => {
    const p = ctx.decodeAudioData(buf, res, rej);
    if (p && typeof p.then === 'function') p.then(res, rej);
  });
  const data = audio.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / bars));
  const peaks: number[] = [];
  let max = 0;
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    const from = i * step;
    const to = Math.min(data.length, from + step);
    for (let j = from; j < to; j += 16) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / Math.max(1, (to - from) / 16));
    peaks.push(rms);
    max = Math.max(max, rms);
  }
  return peaks.map((p) => (max > 0 ? p / max : 0));
}

/** Есть ли в видео звуковая дорожка: ищем признаки аудиотрека в контейнере + API браузера */
async function sniffAudioTrack(file: File, v: HTMLVideoElement): Promise<boolean> {
  const anyV = v as any;
  if (anyV.audioTracks && typeof anyV.audioTracks.length === 'number' && anyV.audioTracks.length > 0) return true;
  if (typeof anyV.mozHasAudio === 'boolean') return anyV.mozHasAudio;
  try {
    const chunk = 4 * 1024 * 1024;
    const parts = [file.slice(0, chunk)];
    if (file.size > chunk) parts.push(file.slice(Math.max(chunk, file.size - chunk)));
    for (const part of parts) {
      const bytes = new Uint8Array(await part.arrayBuffer());
      if (findAscii(bytes, 'soun') || findAscii(bytes, 'A_OPUS') || findAscii(bytes, 'A_VORBIS') || findAscii(bytes, 'A_AAC'))
        return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function findAscii(bytes: Uint8Array, s: string): boolean {
  const c0 = s.charCodeAt(0);
  const n = s.length;
  outer: for (let i = 0; i <= bytes.length - n; i++) {
    if (bytes[i] !== c0) continue;
    for (let k = 1; k < n; k++) if (bytes[i + k] !== s.charCodeAt(k)) continue outer;
    return true;
  }
  return false;
}
