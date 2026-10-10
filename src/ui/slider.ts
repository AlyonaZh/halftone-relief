// Слайдер: полутоновая дорожка, хромовый ползунок, нативный input[type=range] для клавиатуры,
// кнопка «Звук» и встроенное окно аудиореактивности (SPEC §6, §9; docs/changes-v6.md §2, §4).
import {
  SOUND_BUTTON_TIP,
  SOURCE_ORDER,
  SOURCE_SHORT,
  pillTip,
  sourceButtonTip,
  sourceLine,
} from '../audio/sources';
import { type Modulation, type ParamDef } from '../defaults';
import { ICON, clamp, h, svg } from './dom';
import { setTip, tooltip } from './tooltip';

let uid = 0;

export interface SliderOptions {
  def: Pick<ParamDef, 'label' | 'min' | 'max' | 'step' | 'format'>;
  onInput: (v: number) => void;
  /** Включить метку реактивности */
  reactive?: {
    onMod: (patch: Partial<Modulation>) => void;
    /** Нажатие на кнопку «Звук» (закрывает подсказку первого входа) */
    onPill?: () => void;
  };
  compact?: boolean;
}

let openPopover: Slider | null = null;

export class Slider {
  readonly el: HTMLDivElement;
  private input: HTMLInputElement;
  private valEl: HTMLSpanElement;
  private wrap: HTMLDivElement;
  private zone: HTMLDivElement;
  private ghost: HTMLDivElement;
  private tag: HTMLButtonElement | null = null;
  private pop: HTMLDivElement | null = null;
  private depth: Slider | null = null;
  private srcBtns: HTMLButtonElement[] = [];
  private srcLine: HTMLParagraphElement | null = null;
  readonly head: HTMLDivElement;
  private value = 0;
  private mod: Modulation = { source: null, depth: 0.3 };
  private reactiveAvailable = false;

  constructor(private o: SliderOptions) {
    const id = `sl-${++uid}`;
    const { def } = o;
    this.valEl = h('span', { class: 'sl-val' });
    this.input = h('input', {
      type: 'range',
      class: 'sl-input',
      id,
      min: String(def.min),
      max: String(def.max),
      step: String(def.step),
      'aria-label': def.label,
    });
    this.input.addEventListener('input', () => this.emit(parseFloat(this.input.value)));
    this.zone = h('div', { class: 'sl-zone' });
    this.ghost = h('div', { class: 'sl-ghost' });
    this.wrap = h(
      'div',
      { class: 'sl-wrap' },
      h('div', { class: 'sl-track' }, h('div', { class: 'sl-empty' }), h('div', { class: 'sl-fill' }), this.zone),
      this.ghost,
      h('div', { class: 'sl-thumb' }),
      this.input,
    );
    this.bindPointer();

    const head = h('div', { class: 'sl-head' }, h('label', { class: 'sl-label', for: id }, def.label));
    this.head = head;
    if (o.reactive) {
      this.tag = h('button', {
        class: 'rx-pill',
        type: 'button',
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
        onclick: () => {
          o.reactive!.onPill?.();
          this.togglePopover();
        },
      });
      tooltip(this.tag);
      head.append(this.tag);
      this.buildPopover();
    }
    head.append(this.valEl);
    this.el = h('div', { class: 'sl' + (o.compact ? ' sl-compact' : '') }, head, this.wrap, this.pop);
  }

  private emit(v: number) {
    const { min, max, step } = this.o.def;
    v = clamp(Math.round(v / step) * step, min, max);
    v = parseFloat(v.toFixed(4));
    if (v !== this.value) this.o.onInput(v);
  }

  private frac(v: number) {
    const { min, max } = this.o.def;
    return (v - min) / (max - min);
  }

  /** Горизонтальное движение меняет значение; вертикальный свайп отдаётся прокрутке */
  private bindPointer() {
    const wrap = this.wrap;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let pid = -1;
    const valueAt = (clientX: number) => {
      const r = wrap.getBoundingClientRect();
      const tr = (wrap.querySelector<HTMLElement>('.sl-thumb')?.offsetWidth ?? 16) / 2;
      const t = clamp((clientX - r.left - tr) / (r.width - 2 * tr), 0, 1);
      const { min, max } = this.o.def;
      return min + t * (max - min);
    };
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pid = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      if (e.pointerType === 'mouse') {
        dragging = true;
        wrap.setPointerCapture(pid);
        this.input.focus({ preventScroll: true });
        this.emit(valueAt(e.clientX));
        e.preventDefault();
      } else {
        dragging = false;
      }
    });
    wrap.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      if (!dragging) {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (dx > 6 && dx > dy) {
          dragging = true;
          wrap.setPointerCapture(pid);
          wrap.classList.add('dragging');
        } else return;
      }
      this.emit(valueAt(e.clientX));
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      if (e.type === 'pointerup' && !dragging && e.pointerType !== 'mouse') {
        // тап — поставить значение
        if (Math.abs(e.clientX - startX) < 6 && Math.abs(e.clientY - startY) < 6) this.emit(valueAt(e.clientX));
      }
      dragging = false;
      pid = -1;
      wrap.classList.remove('dragging');
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
  }

  private buildPopover() {
    const close = h('button', {
      class: 'icon-btn sm',
      type: 'button',
      'aria-label': 'Закрыть',
      onclick: () => this.togglePopover(false),
    }, svg(ICON.close));
    // повторное нажатие на выбранный источник отключает реакцию; глубина запоминается
    this.srcBtns = SOURCE_ORDER.map((s) => {
      const b = h('button', {
        type: 'button',
        class: 'seg-btn',
        'aria-pressed': 'false',
        onclick: () => {
          if (this.mod.source === s) {
            this.o.reactive!.onMod({ source: null });
            this.togglePopover(false);
            this.tag?.focus({ preventScroll: true });
          } else {
            this.o.reactive!.onMod({ source: s });
          }
        },
      }, SOURCE_SHORT[s]);
      tooltip(b, sourceButtonTip(s, false));
      return b;
    });
    this.srcLine = h('p', { class: 'rx-line' }, sourceLine(null));
    this.depth = new Slider({
      def: {
        label: 'Глубина',
        min: 0,
        max: 1,
        step: 0.01,
        format: (v) => `+${v.toFixed(2)}`,
      },
      onInput: (v) => this.o.reactive!.onMod({ depth: v }),
      compact: true,
    });
    this.pop = h('div', { class: 'rx-pop', hidden: true, role: 'dialog', 'aria-label': `Реакция на звук: ${this.o.def.label}` },
      h('div', { class: 'rx-head' }, h('span', null, 'Реагирует на'), close),
      h('div', { class: 'seg rx-src' }, this.srcBtns),
      this.srcLine,
      this.depth.el,
    );
  }

  togglePopover(force?: boolean) {
    if (!this.pop) return;
    const open = force ?? this.pop.hidden;
    if (open && openPopover && openPopover !== this) openPopover.togglePopover(false);
    this.pop.hidden = !open;
    this.tag?.setAttribute('aria-expanded', String(open));
    this.el.classList.toggle('pop-open', open);
    openPopover = open ? this : openPopover === this ? null : openPopover;
    if (open && this.tag) {
      const tr = this.tag.getBoundingClientRect();
      const er = this.el.getBoundingClientRect();
      this.pop.style.setProperty('--arrow-x', `${tr.left - er.left + tr.width / 2}px`);
    }
  }

  setValue(v: number) {
    if (v === this.value && this.input.value === String(v)) return;
    this.value = v;
    this.input.value = String(v);
    this.valEl.textContent = this.o.def.format(v);
    this.el.style.setProperty('--p', String(this.frac(v)));
    this.updateZone();
  }

  private rxKey = '';

  setReactive(mod: Modulation, available: boolean) {
    const key = `${mod.source}|${mod.depth}|${available}`;
    if (key === this.rxKey) return;
    this.rxKey = key;
    this.mod = mod;
    this.reactiveAvailable = available;
    if (!this.tag) {
      this.updateZone();
      return;
    }
    this.tag.hidden = !available;
    if (!available && this.pop && !this.pop.hidden) this.togglePopover(false);
    const active = available && !!mod.source;
    const label = this.o.def.label;
    this.tag.classList.toggle('on', active);
    this.tag.replaceChildren(svg(ICON.freq, 'ico rx-ico'), active ? SOURCE_SHORT[mod.source!] : 'Звук');
    this.tag.setAttribute(
      'aria-label',
      active ? `Реакция на звук: ${SOURCE_SHORT[mod.source!]}, настроить — ${label}` : `Включить реакцию на звук — ${label}`,
    );
    setTip(this.tag, active ? pillTip(mod.source!) : SOUND_BUTTON_TIP);
    this.srcBtns.forEach((b, i) => {
      const s = SOURCE_ORDER[i];
      const on = s === mod.source;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      setTip(b, sourceButtonTip(s, on));
    });
    if (this.srcLine) this.srcLine.textContent = sourceLine(mod.source);
    this.depth?.setValue(mod.depth);
    this.updateZone();
  }

  private updateZone() {
    const on = this.reactiveAvailable && !!this.mod.source && this.mod.depth > 0;
    this.el.classList.toggle('modulated', on);
    if (!on) return;
    const a = this.frac(this.value);
    const b = clamp(a + this.mod.depth, 0, 1);
    this.zone.style.setProperty('--a', String(a));
    this.zone.style.setProperty('--b', String(b));
  }

  /** Кнопка «Звук» (для подсказки первого входа) */
  get pill() {
    return this.tag;
  }

  /** Текущее значение с модуляцией (призрачный ползунок) */
  setLive(v: number | null) {
    if (v === null) return;
    this.ghost.style.setProperty('--g', String(this.frac(v)));
  }
}
