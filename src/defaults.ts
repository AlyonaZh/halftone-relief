// Все значения по умолчанию и зашитые константы — в одном месте (SPEC §2, §4).

export type ParamKey =
  | 'warpStrength'
  | 'warpScale'
  | 'dotSize'
  | 'threshold'
  | 'volume'
  | 'gloss'
  | 'contourCount'
  | 'contourWidth'
  | 'intensity';

export type AudioSource = 'low' | 'mid' | 'high' | 'kick';

export interface ParamDef {
  key: ParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  /** Значение для правой колонки слайдера */
  format: (v: number) => string;
  /** Короткий формат для сводки в заголовке раздела */
  short?: (v: number) => string;
}

const f2 = (v: number) => v.toFixed(2);

export const PARAMS: Record<ParamKey, ParamDef> = {
  warpStrength: { key: 'warpStrength', label: 'Сила', min: 0, max: 1, step: 0.01, def: 0.42, format: f2 },
  warpScale: { key: 'warpScale', label: 'Масштаб волн', min: 0, max: 1, step: 0.01, def: 0.6, format: f2 },
  dotSize: {
    key: 'dotSize', label: 'Размер точки', min: 3, max: 24, step: 1, def: 9,
    format: (v) => `${Math.round(v)} px`,
  },
  threshold: {
    key: 'threshold', label: 'Порог', min: 0, max: 100, step: 1, def: 78,
    format: (v) => `${Math.round(v)}%`,
  },
  volume: { key: 'volume', label: 'Объём', min: 0, max: 1, step: 0.01, def: 0.78, format: f2 },
  gloss: { key: 'gloss', label: 'Блеск', min: 0, max: 1, step: 0.01, def: 0.7, format: f2 },
  contourCount: {
    key: 'contourCount', label: 'Количество линий', min: 1, max: 16, step: 1, def: 6,
    format: (v) => `${Math.round(v)}`,
  },
  contourWidth: {
    key: 'contourWidth', label: 'Толщина линий', min: 0.5, max: 5, step: 0.1, def: 1.5,
    format: (v) => `${v.toFixed(1)} px`,
  },
  intensity: { key: 'intensity', label: 'Интенсивность', min: 0, max: 1, step: 0.01, def: 1, format: f2 },
};

export const PARAM_KEYS = Object.keys(PARAMS) as ParamKey[];

export type ColorMode = 'bw' | 'tone' | 'orig';
export type ToneMode = 'solid' | 'gradient';

export interface Modulation {
  source: AudioSource | null;
  /** 0…1 от диапазона параметра */
  depth: number;
}

export interface Settings {
  params: Record<ParamKey, number>;
  mods: Record<ParamKey, Modulation>;
  contoursOn: boolean;
  colorMode: ColorMode;
  toneMode: ToneMode;
  solidColor: string;
  shadowColor: string;
  lightColor: string;
  invert: boolean;
}

export const DEFAULT_MOD_DEPTH = 0.3;

export function defaultSettings(): Settings {
  const params = {} as Record<ParamKey, number>;
  const mods = {} as Record<ParamKey, Modulation>;
  for (const k of PARAM_KEYS) {
    params[k] = PARAMS[k].def;
    mods[k] = { source: null, depth: DEFAULT_MOD_DEPTH };
  }
  return {
    params,
    mods,
    contoursOn: true,
    colorMode: 'bw',
    toneMode: 'gradient',
    solidColor: '#FFFFFF',
    shadowColor: '#000000',
    lightColor: '#FFFFFF',
    invert: false,
  };
}

/** Зашитые технические значения — в интерфейсе не показываются. */
export const CONST = {
  gridAngleDeg: 12,
  /** Максимальный радиус точки в долях шага сетки (>0.707 — точки сливаются) */
  dotMaxRadius: 0.68,
  /** Сила слияния точек (smooth-min), в долях шага */
  dotMerge: 0.14,
  contrast: 1.18,
  gamma: 0.92,
  thresholdSoftness: 0.02,
  lightAzimuthDeg: 315,
  lightElevationDeg: 45,
  /** Амплитуда искажения при «Силе» = 1, в долях высоты кадра */
  warpMaxAmp: 0.032,
  /** Частота шума при «Масштабе волн» = 0 и = 1 (периодов на высоту кадра) */
  warpFreqMin: 1.2,
  warpFreqMax: 12,
  /** Скорость течения поля во времени (единиц шума в секунду) */
  warpFlow: 0.07,
};

/** Лимиты входных файлов (SPEC §5) */
export const LIMITS = {
  videoMaxBytes: 500 * 1024 * 1024,
  photoMaxBytes: 50 * 1024 * 1024,
  audioMaxBytes: 100 * 1024 * 1024,
  videoMaxLong: 1920,
  videoMaxShort: 1080,
  photoMaxSide: 4096,
  maxFragment: 120,
  exportVideoMaxLong: 1920,
  exportVideoMaxShort: 1080,
};

export const AUDIO = {
  fftSize: 2048,
  bands: {
    low: { from: 20, to: 250, attack: 0.03, release: 0.25 },
    mid: { from: 250, to: 4000, attack: 0.03, release: 0.25 },
    high: { from: 4000, to: 16000, attack: 0.02, release: 0.2 },
  },
  kick: {
    from: 40,
    to: 120,
    release: 0.18,
    /** Минимальный рост энергии полосы за ~70 мс, доли шкалы анализатора (~10 дБ) */
    minRise: 0.15,
  },
  minDb: -85,
  maxDb: -20,
};

export const RECORD = {
  fps: 30,
  videoBitsPerSecond: 12_000_000,
  audioBitsPerSecond: 192_000,
  minMobileFps: 24,
};
