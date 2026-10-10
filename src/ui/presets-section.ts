// Раздел «Пресеты» в самом верху панели: три карточки с превью (docs/changes-v6.md §5, §6).
import { PRESETS, presetPatch, type PresetId } from '../presets';
import { app, dismissCoach, reactiveSource, settings } from '../state';
import { h } from './dom';
import { setTip, tooltip } from './tooltip';

const NEED_AUDIO = 'Добавьте аудио, чтобы включить пресеты';

export class PresetsSection {
  readonly el: HTMLElement;
  private cards = new Map<PresetId, { btn: HTMLButtonElement; canvas: HTMLCanvasElement }>();
  private hint: HTMLParagraphElement;
  private hintTimer = 0;
  private lastPointer = 'mouse';

  constructor() {
    const grid = h('div', { class: 'presets' });
    for (const p of PRESETS) {
      const canvas = h('canvas', { class: 'preset-img', 'aria-hidden': 'true' });
      const btn = h('button', {
        type: 'button',
        class: 'preset',
        'aria-label': `Пресет «${p.name}»`,
        onclick: () => this.pick(p.id),
      }, canvas, h('i', { class: 'preset-ring', 'aria-hidden': 'true' }));
      btn.addEventListener('pointerdown', (e) => (this.lastPointer = e.pointerType));
      tooltip(btn);
      grid.append(btn);
      this.cards.set(p.id, { btn, canvas });
    }
    this.hint = h('p', { class: 'preset-hint', hidden: true, role: 'status' }, NEED_AUDIO);
    this.el = h('section', { class: 'sec sec-presets', 'data-sec': 'presets' },
      h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title' }, 'Пресеты')),
      h('div', { class: 'sec-body' }, grid, this.hint),
    );
    app.subscribe(() => this.sync());
    this.sync();
  }

  private get enabled() {
    return reactiveSource(app.get()) !== null;
  }

  private pick(id: PresetId) {
    if (!this.enabled) {
      // на сенсорных экранах наведения нет — показываем подсказку текстом на 3 секунды
      if (this.lastPointer !== 'mouse') {
        this.hint.hidden = false;
        clearTimeout(this.hintTimer);
        this.hintTimer = window.setTimeout(() => (this.hint.hidden = true), 3000);
      }
      return;
    }
    const preset = PRESETS.find((p) => p.id === id)!;
    settings.set((s) => presetPatch(s, preset));
    app.set({ preset: id });
    dismissCoach();
  }

  private sync() {
    const enabled = this.enabled;
    const selected = app.get().preset;
    if (enabled) this.hint.hidden = true;
    for (const [id, { btn }] of this.cards) {
      btn.setAttribute('aria-disabled', String(!enabled));
      btn.setAttribute('aria-pressed', String(enabled && selected === id));
      btn.classList.toggle('on', enabled && selected === id);
      setTip(btn, enabled ? '' : NEED_AUDIO);
    }
  }

  /** Превью пресета: пиксели сверху вниз, null — превью нет (карточка #161618) */
  setPreview(id: PresetId, px: Uint8ClampedArray | null, w = 0, hh = 0) {
    const card = this.cards.get(id);
    if (!card) return;
    const c = card.canvas;
    if (!px) {
      c.classList.remove('ready');
      return;
    }
    if (c.width !== w || c.height !== hh) {
      c.width = w;
      c.height = hh;
    }
    c.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, hh), 0, 0);
    c.classList.add('ready');
  }

  /** Размер карточки в пикселях устройства — под него рендерится превью */
  cardPixelSize(): [number, number] {
    const btn = this.cards.values().next().value!.btn;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = btn.clientWidth || 88;
    const hh = btn.clientHeight || 64;
    return [Math.round(w * dpr), Math.round(hh * dpr)];
  }
}
