// Панель настроек: Аудио, Искажение, Растр, Рельеф, Контуры, Цвет (SPEC §4, §6, §7, §9).
import { PARAMS, type ParamKey, type Settings } from '../defaults';
import { app, loadCollapsed, reactiveSource, saveCollapsed, setMod, setParam, settings } from '../state';
import { HsbPicker } from './color-picker';
import { ICON, h, svg } from './dom';
import { Slider } from './slider';

export interface PanelActions {
  addAudio(): void;
  removeAudio(): void;
  shuffle(): void;
}

type SectionId = 'audio' | 'warp' | 'raster' | 'relief' | 'contours' | 'color';

interface Section {
  id: SectionId;
  el: HTMLElement;
  summary: HTMLSpanElement;
  dot: HTMLSpanElement;
  keys: ParamKey[];
}

export class SettingsPanel {
  readonly el: HTMLDivElement;
  readonly sections: Section[] = [];
  private sliders = new Map<ParamKey, Slider>();
  private collapsed = loadCollapsed();
  private audioBody!: HTMLDivElement;
  private contourToggle!: HTMLButtonElement;
  private colorEls!: {
    modes: HTMLButtonElement[];
    toneRow: HTMLDivElement;
    toneModes: HTMLButtonElement[];
    solidRow: HTMLDivElement;
    solidSwatch: HTMLButtonElement;
    gradRow: HTMLDivElement;
    shadowSwatch: HTMLButtonElement;
    lightSwatch: HTMLButtonElement;
    gradBar: HTMLDivElement;
    intensity: HTMLElement;
    invert: HTMLButtonElement;
  };
  private picker = new HsbPicker();

  constructor(private actions: PanelActions) {
    this.el = h('div', { class: 'panel', role: 'region', 'aria-label': 'Настройки' });
    this.buildAudio();
    this.buildParamsSection('warp', 'Искажение', ['warpStrength', 'warpScale'], [
      h('button', { class: 'text-btn shuffle', type: 'button', onclick: () => this.actions.shuffle() },
        svg(ICON.shuffle), 'Перемешать'),
    ]);
    this.buildParamsSection('raster', 'Растр', ['dotSize', 'threshold']);
    this.buildParamsSection('relief', 'Рельеф', ['volume', 'gloss']);
    this.contourToggle = toggle('Контуры', () => settings.set((s) => ({ contoursOn: !s.contoursOn })));
    this.buildParamsSection('contours', 'Контуры', ['contourCount', 'contourWidth'], [this.contourToggle]);
    this.buildColor();

    settings.subscribe(() => this.sync());
    app.subscribe(() => this.sync());
    document.addEventListener('pointerdown', (e) => {
      if (!this.picker.isOpen) return;
      const t = e.target as Node;
      if (this.picker.el.contains(t) || this.picker.anchor?.contains(t)) return;
      this.picker.close();
      this.syncSwatches();
    });
    this.sync();
  }

  // ---------- Разделы ----------

  private section(id: SectionId, title: string, body: HTMLElement[], extras: HTMLElement[] = [], keys: ParamKey[] = []) {
    const summary = h('span', { class: 'sec-summary' });
    const dot = h('span', { class: 'sec-dot', hidden: true, title: 'Реагирует на звук' });
    const chev = svg(ICON.chevronDown, 'ico chev');
    const bodyEl = h('div', { class: 'sec-body', id: `sec-${id}` }, body);
    const btn = h('button', {
      class: 'sec-toggle',
      type: 'button',
      'aria-controls': `sec-${id}`,
      onclick: () => this.setCollapsed(id, !this.isCollapsed(id)),
    }, h('span', { class: 'sec-title' }, title), dot, summary, chev);
    const el = h('section', { class: 'sec', 'data-sec': id },
      h('div', { class: 'sec-head' }, btn, extras.length ? h('div', { class: 'sec-extras' }, extras) : null),
      bodyEl,
    );
    const sec: Section = { id, el, summary, dot, keys };
    this.sections.push(sec);
    this.el.append(el);
    this.applyCollapsed(sec);
    return sec;
  }

  isCollapsed(id: SectionId) {
    return !!this.collapsed[id];
  }

  setCollapsed(id: SectionId, v: boolean) {
    this.collapsed = { ...this.collapsed, [id]: v };
    saveCollapsed(this.collapsed);
    const sec = this.sections.find((s) => s.id === id);
    if (sec) this.applyCollapsed(sec);
  }

  private applyCollapsed(sec: Section) {
    const c = this.isCollapsed(sec.id);
    sec.el.classList.toggle('collapsed', c);
    sec.el.querySelector('.sec-toggle')!.setAttribute('aria-expanded', String(!c));
  }

  /** Раскрыть раздел и прокрутить к нему (мобильная шторка) */
  reveal(id: SectionId) {
    this.setCollapsed(id, false);
    const sec = this.sections.find((s) => s.id === id);
    sec?.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  private slider(key: ParamKey) {
    const s = new Slider({
      def: PARAMS[key],
      onInput: (v) => setParam(key, v),
      reactive: { onMod: (patch) => setMod(key, patch) },
    });
    this.sliders.set(key, s);
    return s.el;
  }

  private buildParamsSection(id: SectionId, title: string, keys: ParamKey[], extras: HTMLElement[] = []) {
    this.section(id, title, keys.map((k) => this.slider(k)), extras, keys);
  }

  private buildAudio() {
    this.audioBody = h('div', { class: 'audio-body' });
    this.section('audio', 'Аудио', [this.audioBody]);
  }

  private renderAudio() {
    const a = app.get();
    const body = this.audioBody;
    const addBtn = () =>
      h('button', { class: 'outline-btn wide', type: 'button', onclick: () => this.actions.addAudio() },
        svg(ICON.plus), 'Добавить аудио');
    const key = [a.audioFile, a.audioName, a.media, a.videoHasAudio, a.useVideoSound, a.audioPeaks.length].join('|');
    if (body.dataset.key === key) return;
    body.dataset.key = key;
    body.replaceChildren();
    if (a.audioFile) {
      const wave = h('div', { class: 'wave' },
        a.audioPeaks.map((p) => h('i', { style: { height: `${Math.max(8, p * 100)}%` } })));
      body.append(
        h('div', { class: 'audio-row' },
          svg(ICON.music, 'ico muted'),
          h('div', { class: 'wave-wrap', title: a.audioName }, wave),
          h('button', {
            class: 'icon-btn sm',
            type: 'button',
            'aria-label': 'Убрать аудио',
            onclick: () => this.actions.removeAudio(),
          }, svg(ICON.close))),
      );
      if (a.media === 'video' && a.videoHasAudio) {
        const cb = h('input', {
          type: 'checkbox',
          checked: a.useVideoSound,
          onchange: (e: Event) => app.set({ useVideoSound: (e.target as HTMLInputElement).checked }),
        });
        body.append(h('label', { class: 'check' }, cb, h('span', { class: 'check-box' }), 'Использовать звук из видео'));
      }
    } else if (a.media === 'video' && a.videoHasAudio) {
      body.append(h('p', { class: 'audio-note' }, 'Реагирует на звук из видео'), addBtn());
    } else {
      body.append(addBtn(), h('p', { class: 'hint' }, 'Эффект начнёт реагировать на звук'));
    }
  }

  private buildColor() {
    const modeBtn = (label: string, mode: Settings['colorMode']) =>
      h('button', { type: 'button', class: 'seg-btn', onclick: () => settings.set({ colorMode: mode }) }, label);
    const modes = [modeBtn('Ч/Б', 'bw'), modeBtn('Тон', 'tone'), modeBtn('Исходные', 'orig')];
    const toneBtn = (label: string, mode: Settings['toneMode']) =>
      h('button', { type: 'button', class: 'seg-btn', onclick: () => settings.set({ toneMode: mode }) }, label);
    const toneModes = [toneBtn('Сплошной', 'solid'), toneBtn('Градиент', 'gradient')];

    const swatch = (label: string, key: 'solidColor' | 'shadowColor' | 'lightColor') => {
      const b = h('button', {
        type: 'button',
        class: 'swatch',
        'aria-label': `Цвет: ${label}`,
        onclick: () => {
          if (this.picker.isOpen && this.picker.anchor === b) {
            this.picker.close();
          } else {
            this.picker.open(b, settings.get()[key], (hex) => settings.set({ [key]: hex } as Partial<Settings>));
          }
          this.syncSwatches();
        },
      });
      return b;
    };
    const solidSwatch = swatch('Цвет', 'solidColor');
    const shadowSwatch = swatch('Тени', 'shadowColor');
    const lightSwatch = swatch('Света', 'lightColor');
    const gradBar = h('div', { class: 'grad-bar' });
    const swapBtn = h('button', {
      type: 'button',
      class: 'icon-btn sm swap',
      'aria-label': 'Поменять местами',
      onclick: () => settings.set((s) => ({ shadowColor: s.lightColor, lightColor: s.shadowColor })),
    }, svg(ICON.swap));
    const solidRow = h('div', { class: 'swatch-row solid' },
      h('div', { class: 'swatch-col' }, solidSwatch, h('span', null, 'Цвет')));
    const gradRow = h('div', { class: 'swatch-row grad' },
      h('div', { class: 'swatch-col' }, shadowSwatch, h('span', null, 'Тени')),
      h('div', { class: 'grad-mid' }, gradBar, swapBtn),
      h('div', { class: 'swatch-col' }, lightSwatch, h('span', null, 'Света')),
    );
    const toneRow = h('div', { class: 'seg tone-seg' }, toneModes);
    const intensity = this.slider('intensity');
    const invert = toggle('Инверсия', () => settings.set((s) => ({ invert: !s.invert })));
    const pickerHost = h('div', { class: 'cp-host' }, this.picker.el);
    this.colorEls = { modes, toneRow, toneModes, solidRow, solidSwatch, gradRow, shadowSwatch, lightSwatch, gradBar, intensity, invert };
    this.section('color', 'Цвет', [
      h('div', { class: 'seg modes' }, modes),
      toneRow,
      solidRow,
      gradRow,
      pickerHost,
      intensity,
      h('div', { class: 'toggle-row' }, h('span', null, 'Инверсия'), invert),
    ], [], ['intensity']);
  }

  private syncSwatches() {
    const c = this.colorEls;
    for (const b of [c.solidSwatch, c.shadowSwatch, c.lightSwatch]) {
      b.classList.toggle('open', this.picker.isOpen && this.picker.anchor === b);
    }
  }

  // ---------- Синхронизация с состоянием ----------

  private sync() {
    const s = settings.get();
    const a = app.get();
    const available = reactiveSource(a) !== null;
    this.el.classList.toggle('no-reactive', !available);
    for (const [k, sl] of this.sliders) {
      sl.setValue(s.params[k]);
      sl.setReactive(s.mods[k], available);
    }
    this.renderAudio();

    // Контуры
    setToggle(this.contourToggle, s.contoursOn);
    this.sections.find((x) => x.id === 'contours')!.el.classList.toggle('off', !s.contoursOn);

    // Цвет
    const c = this.colorEls;
    const modeIdx = { bw: 0, tone: 1, orig: 2 }[s.colorMode];
    c.modes.forEach((b, i) => b.classList.toggle('on', i === modeIdx));
    c.toneModes.forEach((b, i) => b.classList.toggle('on', i === (s.toneMode === 'solid' ? 0 : 1)));
    const tone = s.colorMode === 'tone';
    c.toneRow.hidden = !tone;
    c.solidRow.hidden = !(tone && s.toneMode === 'solid');
    c.gradRow.hidden = !(tone && s.toneMode === 'gradient');
    c.intensity.hidden = s.colorMode === 'bw';
    c.solidSwatch.style.background = s.solidColor;
    c.shadowSwatch.style.background = s.shadowColor;
    c.lightSwatch.style.background = s.lightColor;
    c.gradBar.style.background = `linear-gradient(90deg, ${s.shadowColor}, ${s.lightColor})`;
    setToggle(c.invert, s.invert);
    if (this.picker.isOpen) {
      const anchor = this.picker.anchor;
      const visible = anchor && anchor.closest('[hidden]') === null;
      if (!visible) {
        this.picker.close();
        this.syncSwatches();
      }
    }

    // Сводки и точки реактивности
    const P = s.params;
    const sum: Record<SectionId, string> = {
      audio: a.audioFile && reactiveSource(a) === 'file'
        ? 'звук из файла'
        : reactiveSource(a) === 'video' ? 'звук из видео' : 'нет звука',
      warp: `${P.warpStrength.toFixed(2)} · ${P.warpScale.toFixed(2)}`,
      raster: `${Math.round(P.dotSize)} px · ${Math.round(P.threshold)}%`,
      relief: `${P.volume.toFixed(2)} · ${P.gloss.toFixed(2)}`,
      contours: s.contoursOn ? `${Math.round(P.contourCount)} · ${P.contourWidth.toFixed(1)} px` : 'выкл',
      color: { bw: 'ч/б', tone: s.toneMode === 'solid' ? 'тон' : 'градиент', orig: 'исходные' }[s.colorMode],
    };
    for (const sec of this.sections) {
      sec.summary.textContent = sum[sec.id];
      const activeMod = available && sec.keys.some((k) => s.mods[k].source && s.mods[k].depth > 0);
      sec.dot.hidden = !activeMod;
    }
  }

  /** Каждый кадр: призрачные ползунки модулируемых слайдеров */
  frame(live: Record<ParamKey, number>) {
    const s = settings.get();
    for (const [k, sl] of this.sliders) {
      if (s.mods[k].source) sl.setLive(live[k]);
    }
  }
}

function toggle(label: string, onClick: () => void): HTMLButtonElement {
  return h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-label': label, onclick: onClick },
    h('span', { class: 'switch-knob' }));
}

function setToggle(b: HTMLButtonElement, on: boolean) {
  b.classList.toggle('on', on);
  b.setAttribute('aria-checked', String(on));
}
