// Таймлайн: пауза/воспроизведение, время, дорожка с ручками начала и конца фрагмента, длительность.
import { LIMITS } from '../defaults';
import { app } from '../state';
import { ICON, clamp, fmtTime, h, svg } from './dom';

export interface TimelineActions {
  togglePlay(): void;
  seek(t: number): void;
  setRange(inPoint: number, outPoint: number): void;
}

const MIN_FRAGMENT = 0.5;

export class Timeline {
  readonly el: HTMLDivElement;
  private playBtn: HTMLButtonElement;
  private cur: HTMLSpanElement;
  private dur: HTMLSpanElement;
  private track: HTMLDivElement;
  private handleIn: HTMLDivElement;
  private handleOut: HTMLDivElement;
  private head: HTMLDivElement;
  private time = 0;

  constructor(private actions: TimelineActions) {
    this.playBtn = h('button', {
      class: 'play-btn',
      type: 'button',
      'aria-label': 'Воспроизвести',
      onclick: () => this.actions.togglePlay(),
    }, svg(ICON.play));
    this.cur = h('span', { class: 'tl-time' }, '0:00');
    this.dur = h('span', { class: 'tl-time dim' }, '0:00');
    this.handleIn = h('div', {
      class: 'tl-handle in', tabindex: '0', role: 'slider', 'aria-label': 'Начало фрагмента',
    });
    this.handleOut = h('div', {
      class: 'tl-handle out', tabindex: '0', role: 'slider', 'aria-label': 'Конец фрагмента',
    });
    this.head = h('div', { class: 'tl-head', tabindex: '0', role: 'slider', 'aria-label': 'Позиция' });
    this.track = h('div', { class: 'tl-track' },
      h('div', { class: 'tl-rail' }),
      h('div', { class: 'tl-sel' }),
      h('div', { class: 'tl-played' }),
      this.handleIn,
      this.handleOut,
      this.head,
    );
    this.el = h('div', { class: 'timeline', hidden: true }, this.playBtn, this.cur, this.track, this.dur);
    this.bind();
    app.subscribe(() => this.sync());
    this.sync();
  }

  private tAt(clientX: number) {
    const r = this.track.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * app.get().duration;
  }

  private bind() {
    const drag = (el: HTMLElement, fn: (t: number) => void) => {
      el.addEventListener('pointerdown', (e) => {
        if (app.get().exportStage === 'recording') return;
        e.stopPropagation();
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('drag');
      });
      el.addEventListener('pointermove', (e) => {
        if (el.hasPointerCapture(e.pointerId)) fn(this.tAt(e.clientX));
      });
      const up = (e: PointerEvent) => {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        el.classList.remove('drag');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    drag(this.handleIn, (t) => this.moveIn(t));
    drag(this.handleOut, (t) => this.moveOut(t));
    drag(this.head, (t) => this.seekClamped(t));
    this.track.addEventListener('pointerdown', (e) => {
      if (app.get().exportStage === 'recording') return;
      this.seekClamped(this.tAt(e.clientX));
      this.head.setPointerCapture(e.pointerId);
      this.head.classList.add('drag');
    });

    const keys = (el: HTMLElement, fn: (delta: number) => void) =>
      el.addEventListener('keydown', (e) => {
        if (app.get().exportStage === 'recording') return;
        const d = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') fn(-d);
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') fn(d);
        else return;
        e.preventDefault();
      });
    keys(this.handleIn, (d) => this.moveIn(app.get().inPoint + d));
    keys(this.handleOut, (d) => this.moveOut(app.get().outPoint + d));
    keys(this.head, (d) => this.seekClamped(this.time + d));
  }

  private moveIn(t: number) {
    const { outPoint } = app.get();
    const v = clamp(t, Math.max(0, outPoint - LIMITS.maxFragment), outPoint - MIN_FRAGMENT);
    this.actions.setRange(v, outPoint);
  }

  private moveOut(t: number) {
    const { inPoint, duration } = app.get();
    const v = clamp(t, inPoint + MIN_FRAGMENT, Math.min(duration, inPoint + LIMITS.maxFragment));
    this.actions.setRange(inPoint, v);
  }

  private seekClamped(t: number) {
    const { inPoint, outPoint } = app.get();
    this.actions.seek(clamp(t, inPoint, outPoint));
  }

  private sync() {
    const a = app.get();
    this.el.hidden = !a.timeline;
    const d = a.duration || 1;
    this.el.style.setProperty('--in', String(a.inPoint / d));
    this.el.style.setProperty('--out', String(a.outPoint / d));
    this.dur.textContent = fmtTime(a.duration);
    this.playBtn.replaceChildren(svg(a.playing ? ICON.pause : ICON.play));
    this.playBtn.setAttribute('aria-label', a.playing ? 'Пауза' : 'Воспроизвести');
    this.el.classList.toggle('locked', a.exportStage === 'recording');
    this.playBtn.disabled = a.exportStage === 'recording';
    this.handleIn.setAttribute('aria-valuetext', fmtTime(a.inPoint));
    this.handleOut.setAttribute('aria-valuetext', fmtTime(a.outPoint));
  }

  /** Каждый кадр — позиция воспроизведения */
  frame(t: number) {
    this.time = t;
    const d = app.get().duration || 1;
    this.el.style.setProperty('--t', String(t / d));
    const txt = fmtTime(t);
    if (this.cur.textContent !== txt) this.cur.textContent = txt;
    this.head.setAttribute('aria-valuetext', txt);
  }
}
