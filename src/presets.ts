// Звуковые пресеты: вид эффекта + готовая реакция на звук (docs/changes-v6.md §5, SPEC §6а).
import { PARAM_KEYS, type AudioSource, type Modulation, type ParamKey, type Settings } from './defaults';

export type PresetId = 'relief' | 'chrome' | 'print';

export interface Preset {
  id: PresetId;
  name: string;
  /** Параметры эффекта (раздел «Цвет», в т.ч. «Интенсивность», пресеты не трогают) */
  params: Record<Exclude<ParamKey, 'intensity'>, number>;
  contoursOn: boolean;
  /** Реакции на звук; у остальных слайдеров эффекта реакция выключается */
  mods: Partial<Record<ParamKey, { source: AudioSource; depth: number }>>;
}

export const PRESETS: Preset[] = [
  {
    id: 'relief',
    name: 'Рельеф',
    params: {
      warpStrength: 0.42,
      warpScale: 0.6,
      dotSize: 9,
      threshold: 78,
      volume: 0.78,
      gloss: 0.7,
      contourCount: 6,
      contourWidth: 1.5,
    },
    contoursOn: true,
    mods: {
      warpStrength: { source: 'low', depth: 0.3 },
      volume: { source: 'kick', depth: 0.15 },
    },
  },
  {
    id: 'chrome',
    name: 'Жидкий хром',
    params: {
      warpStrength: 0.85,
      warpScale: 0.35,
      dotSize: 12,
      threshold: 82,
      volume: 1,
      gloss: 1,
      contourCount: 6,
      contourWidth: 1.5,
    },
    contoursOn: false,
    mods: {
      warpStrength: { source: 'kick', depth: 0.15 },
      warpScale: { source: 'low', depth: 0.2 },
      gloss: { source: 'high', depth: 0.1 },
    },
  },
  {
    id: 'print',
    name: 'Печать',
    params: {
      warpStrength: 0.15,
      warpScale: 0.7,
      dotSize: 5,
      threshold: 70,
      volume: 0.15,
      gloss: 0,
      contourCount: 10,
      contourWidth: 0.8,
    },
    contoursOn: true,
    mods: {
      dotSize: { source: 'low', depth: 0.15 },
      threshold: { source: 'kick', depth: 0.1 },
    },
  },
];

/** Слайдеры эффекта, которыми управляет пресет (всё, кроме раздела «Цвет») */
export const PRESET_KEYS = PARAM_KEYS.filter((k) => k !== 'intensity');

/** Изменения состояния при нажатии на пресет. Глубина у выключенных реакций запоминается. */
export function presetPatch(s: Settings, p: Preset): Partial<Settings> {
  const params = { ...s.params, ...p.params };
  const mods = { ...s.mods };
  for (const k of PRESET_KEYS) {
    const m = p.mods[k];
    mods[k] = m ? { source: m.source, depth: m.depth } : ({ ...s.mods[k], source: null } as Modulation);
  }
  return { params, mods, contoursOn: p.contoursOn };
}

/** Изменилось ли что-то, что снимает выделение пресета (цвет — нет) */
export function effectChanged(s: Settings, prev: Settings): boolean {
  if (s.contoursOn !== prev.contoursOn) return true;
  for (const k of PRESET_KEYS) {
    if (s.params[k] !== prev.params[k]) return true;
    if (s.mods[k].source !== prev.mods[k].source || s.mods[k].depth !== prev.mods[k].depth) return true;
  }
  return false;
}
