// Своя HSB-палитра: квадрат насыщенности/яркости, полоса оттенков, образец и поле HEX (SPEC §7).
import { ICON, clamp, h, svg } from './dom';

export function hexToHsv(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, max ? d / max : 0, max];
}

export function hsvToHex(hh: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let rgb: number[];
  if (hh < 60) rgb = [c, x, 0];
  else if (hh < 120) rgb = [x, c, 0];
  else if (hh < 180) rgb = [0, c, x];
  else if (hh < 240) rgb = [0, x, c];
  else if (hh < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return (
    '#' +
    rgb
      .map((u) => Math.round((u + m) * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export class HsbPicker {
  readonly el: HTMLDivElement;
  private sv: HTMLDivElement;
  private svKnob: HTMLDivElement;
  private hue: HTMLDivElement;
  private hueKnob: HTMLDivElement;
  private sample: HTMLDivElement;
  private hexInput: HTMLInputElement;
  private hsv: [number, number, number] = [0, 0, 1];
  private onChange: ((hex: string) => void) | null = null;
  /** Элемент-кружок, от которого открыта палитра */
  anchor: HTMLElement | null = null;

  constructor() {
    this.svKnob = h('div', { class: 'cp-knob' });
    this.sv = h('div', {
      class: 'cp-sv',
      tabindex: '0',
      role: 'slider',
      'aria-label': 'Насыщенность и яркость',
    }, this.svKnob);
    this.hueKnob = h('div', { class: 'cp-hue-knob' });
    this.hue = h('div', { class: 'cp-hue', tabindex: '0', role: 'slider', 'aria-label': 'Оттенок' }, this.hueKnob);
    this.sample = h('div', { class: 'cp-sample' });
    this.hexInput = h('input', {
      class: 'cp-hex-input',
      type: 'text',
      maxlength: '7',
      spellcheck: 'false',
      'aria-label': 'HEX',
    });
    const copy = h('button', {
      class: 'icon-btn sm',
      type: 'button',
      'aria-label': 'Скопировать HEX',
      onclick: () => navigator.clipboard?.writeText(this.hex()).catch(() => {}),
    }, svg(ICON.copy));
    this.el = h('div', { class: 'cp', hidden: true },
      this.sv,
      this.hue,
      h('div', { class: 'cp-row' }, this.sample,
        h('label', { class: 'cp-hex' }, h('span', null, 'HEX'), this.hexInput, copy)),
    );

    this.drag(this.sv, (x, y) => {
      this.hsv = [this.hsv[0], x, 1 - y];
      this.commit();
    });
    this.drag(this.hue, (x) => {
      this.hsv = [Math.min(359.9, x * 360), this.hsv[1], this.hsv[2]];
      this.commit();
    });
    this.sv.addEventListener('keydown', (e) => {
      const d = e.shiftKey ? 0.1 : 0.02;
      const [hh, s, v] = this.hsv;
      const map: Record<string, [number, number]> = {
        ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d],
      };
      const k = map[e.key];
      if (!k) return;
      e.preventDefault();
      this.hsv = [hh, clamp(s + k[0], 0, 1), clamp(v + k[1], 0, 1)];
      this.commit();
    });
    this.hue.addEventListener('keydown', (e) => {
      const d = e.shiftKey ? 20 : 4;
      const k = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? d : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -d : 0;
      if (!k) return;
      e.preventDefault();
      this.hsv = [clamp(this.hsv[0] + k, 0, 359.9), this.hsv[1], this.hsv[2]];
      this.commit();
    });
    this.hexInput.addEventListener('change', () => this.fromInput());
    this.hexInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.fromInput();
    });
  }

  private fromInput() {
    let v = this.hexInput.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      this.hsv = hexToHsv(v);
      this.render();
      this.onChange?.(v.toUpperCase());
    } else {
      this.hexInput.value = this.hex();
    }
  }

  private drag(el: HTMLElement, fn: (x: number, y: number) => void) {
    const at = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      fn(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      at(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (el.hasPointerCapture(e.pointerId)) at(e);
    });
  }

  private hex() {
    return hsvToHex(...this.hsv);
  }

  private commit() {
    this.render();
    this.onChange?.(this.hex());
  }

  private render() {
    const [hh, s, v] = this.hsv;
    this.el.style.setProperty('--hue', String(hh));
    this.svKnob.style.left = `${s * 100}%`;
    this.svKnob.style.top = `${(1 - v) * 100}%`;
    this.hueKnob.style.left = `${(hh / 360) * 100}%`;
    const hex = this.hex();
    this.sample.style.background = hex;
    this.svKnob.style.background = hex;
    if (document.activeElement !== this.hexInput) this.hexInput.value = hex;
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open(anchor: HTMLElement, hex: string, onChange: (hex: string) => void) {
    this.anchor = anchor;
    this.onChange = onChange;
    this.hsv = hexToHsv(hex);
    this.el.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pr = this.el.parentElement?.getBoundingClientRect();
    if (pr) this.el.style.setProperty('--arrow-x', `${r.left - pr.left + r.width / 2}px`);
    this.render();
  }

  close() {
    this.el.hidden = true;
    this.anchor = null;
    this.onChange = null;
  }
}
