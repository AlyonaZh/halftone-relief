// Единое состояние: настройки эффекта (сохраняются в localStorage) и состояние приложения.
import { defaultSettings, PARAM_KEYS, PARAMS, type Settings } from './defaults';

type Listener<T> = (state: T, prev: T) => void;

export class Store<T extends object> {
  private listeners = new Set<Listener<T>>();
  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(patch: Partial<T> | ((s: T) => Partial<T>)) {
    const prev = this.value;
    const p = typeof patch === 'function' ? patch(prev) : patch;
    this.value = { ...prev, ...p };
    for (const l of this.listeners) l(this.value, prev);
  }

  subscribe(l: Listener<T>): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

// ---------- Настройки ----------

const SETTINGS_KEY = 'halftone-relief.settings.v1';

function loadSettings(): Settings {
  const def = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return def;
    const saved = JSON.parse(raw) as Partial<Settings>;
    const s: Settings = { ...def, ...saved, params: { ...def.params }, mods: { ...def.mods } };
    for (const k of PARAM_KEYS) {
      const v = saved.params?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        s.params[k] = Math.min(PARAMS[k].max, Math.max(PARAMS[k].min, v));
      }
      const m = saved.mods?.[k];
      if (m && typeof m.depth === 'number') s.mods[k] = { source: m.source ?? null, depth: m.depth };
    }
    return s;
  } catch {
    return def;
  }
}

export const settings = new Store<Settings>(loadSettings());

let saveTimer = 0;
settings.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* приватный режим — не страшно */
    }
  }, 200);
});

export function setParam(key: keyof Settings['params'], value: number) {
  settings.set((s) => ({ params: { ...s.params, [key]: value } }));
}

export function setMod(key: keyof Settings['mods'], patch: Partial<Settings['mods'][typeof key]>) {
  settings.set((s) => ({ mods: { ...s.mods, [key]: { ...s.mods[key], ...patch } } }));
}

// ---------- Состояние приложения ----------

export type MediaKind = 'none' | 'photo' | 'video';
export type ExportStage = 'idle' | 'recording' | 'done';

export interface AppState {
  media: MediaKind;
  srcWidth: number;
  srcHeight: number;
  /** Есть ли звуковая дорожка в видео */
  videoHasAudio: boolean;
  /** Загружен ли аудиофайл */
  audioFile: boolean;
  audioName: string;
  audioPeaks: number[];
  /** Чекбокс «Использовать звук из видео» */
  useVideoSound: boolean;
  /** Есть таймлайн (видео или фото + аудио) */
  timeline: boolean;
  duration: number;
  inPoint: number;
  outPoint: number;
  playing: boolean;
  exportOpen: boolean;
  exportStage: ExportStage;
  seed: number;
  loading: boolean;
}

export const app = new Store<AppState>({
  media: 'none',
  srcWidth: 0,
  srcHeight: 0,
  videoHasAudio: false,
  audioFile: false,
  audioName: '',
  audioPeaks: [],
  useVideoSound: false,
  timeline: false,
  duration: 0,
  inPoint: 0,
  outPoint: 0,
  playing: false,
  exportOpen: false,
  exportStage: 'idle',
  seed: Math.random() * 1000,
  loading: false,
});

/** Источник звука для реактивности (SPEC §6, таблица «Источник звука») */
export function reactiveSource(s: AppState = app.get()): 'file' | 'video' | null {
  if (s.audioFile && !(s.videoHasAudio && s.useVideoSound)) return 'file';
  if (s.media === 'video' && s.videoHasAudio) return 'video';
  return null;
}

// ---------- Сворачивание разделов ----------

const COLLAPSE_KEY = 'halftone-relief.collapsed.v1';

export function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '') || {};
  } catch {
    return { contours: true, color: true };
  }
}

export function saveCollapsed(v: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
