// Запись видео в реальном времени: canvas.captureStream() + MediaRecorder (SPEC §8).
import { RECORD } from '../defaults';

export type VideoFormat = 'mp4' | 'webm';

const CANDIDATES: Record<VideoFormat, string[]> = {
  mp4: [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs="avc1,mp4a"',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ],
  webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
};

export function pickMime(format: VideoFormat): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of CANDIDATES[format]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export class VideoRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  mime = '';

  start(canvas: HTMLCanvasElement, audioTrack: MediaStreamTrack | null, mime: string) {
    const video = canvas.captureStream(RECORD.fps);
    const tracks = [...video.getVideoTracks()];
    if (audioTrack) tracks.push(audioTrack);
    this.stream = new MediaStream(tracks);
    this.chunks = [];
    this.mime = mime;
    this.rec = new MediaRecorder(this.stream, {
      mimeType: mime,
      videoBitsPerSecond: RECORD.videoBitsPerSecond,
      audioBitsPerSecond: RECORD.audioBitsPerSecond,
    });
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(1000);
  }

  stop(): Promise<Blob> {
    const rec = this.rec;
    if (!rec) return Promise.reject(new Error('not recording'));
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = this.mime.split(';')[0] || 'video/webm';
        resolve(new Blob(this.chunks, { type }));
        this.cleanup();
      };
      if (rec.state !== 'inactive') rec.stop();
      else rec.onstop?.(new Event('stop'));
    });
  }

  cancel() {
    if (this.rec && this.rec.state !== 'inactive') {
      this.rec.onstop = null;
      this.rec.stop();
    }
    this.cleanup();
  }

  private cleanup() {
    // видеотрек canvas останавливаем; аудиотрек принадлежит AudioContext — не трогаем
    this.stream?.getVideoTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    this.chunks = [];
  }
}

// Экран не гаснет во время записи (Screen Wake Lock API, где поддерживается)
let wakeLock: { release(): Promise<void> } | null = null;
export async function keepAwake(on: boolean) {
  try {
    if (on && 'wakeLock' in navigator) {
      wakeLock = await (navigator as any).wakeLock.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* не поддерживается — не страшно */
  }
}
