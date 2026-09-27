// Пустое состояние: зона перетаскивания с полутоновым рельефом, подсвеченным вокруг курсора (SPEC §9).
import { LIMITS } from '../defaults';
import { ICON, h, isMobileLayout, svg } from './dom';

const STEP = 9;
const RADIUS = 190;

export class EmptyState {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private pointer: { x: number; y: number } | null = null;
  private auto = 0;
  private raf = 0;
  private visible = true;
  private title: HTMLElement;

  constructor(onPick: () => void) {
    this.canvas = h('canvas', { class: 'empty-dots', 'aria-hidden': 'true' });
    this.ctx = this.canvas.getContext('2d')!;
    this.title = h('h1', { class: 'empty-title' }, 'Перетащите фото или видео');
    const mb = (b: number) => Math.round(b / 1024 / 1024);
    const card = h('div', { class: 'empty-card' },
      svg(ICON.uploadBig, 'ico empty-ico'),
      this.title,
      h('button', { class: 'outline-btn', type: 'button', onclick: (e: Event) => { e.stopPropagation(); onPick(); } }, 'Выбрать файл'),
      h('div', { class: 'empty-limits mono' },
        h('div', null, `Видео — до ${LIMITS.videoMaxLong} × ${LIMITS.videoMaxShort}, 2 мин, ${mb(LIMITS.videoMaxBytes)} МБ`),
        h('div', null, `Фото — до ${LIMITS.photoMaxSide} × ${LIMITS.photoMaxSide}, ${mb(LIMITS.photoMaxBytes)} МБ`)),
      h('div', { class: 'empty-privacy' }, svg(ICON.lock), 'Файлы обрабатываются в браузере и никуда не загружаются'),
    );
    this.el = h('div', { class: 'empty' }, this.canvas, card);
    // на телефоне вся зона — кнопка выбора файла
    this.el.addEventListener('click', () => {
      if (isMobileLayout()) onPick();
    });
    this.el.addEventListener('pointermove', (e) => this.setPointer(e));
    this.el.addEventListener('pointerdown', (e) => this.setPointer(e));
    this.el.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.kick();
    });
    // после касания подсветка снова движется сама
    this.el.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') {
        this.pointer = null;
        this.kick();
      }
    });
    new ResizeObserver(() => this.resize()).observe(this.el);
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const upd = () => (this.title.textContent = mq.matches ? 'Выберите фото или видео' : 'Перетащите фото или видео');
    mq.addEventListener('change', upd);
    upd();
  }

  private setPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.kick();
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.el.hidden = !v;
    if (v) this.kick();
  }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.el.clientWidth;
    const hh = this.el.clientHeight;
    if (!w || !hh) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hh * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${hh}px`;
    // фоновая сетка мелких тёмных точек — рисуется один раз
    const base = document.createElement('canvas');
    base.width = this.canvas.width;
    base.height = this.canvas.height;
    const b = base.getContext('2d')!;
    b.scale(dpr, dpr);
    b.fillStyle = '#1d1d21';
    for (let y = STEP / 2; y < hh; y += STEP) {
      for (let x = STEP / 2; x < w; x += STEP) {
        b.beginPath();
        b.arc(x, y, 1.1, 0, Math.PI * 2);
        b.fill();
      }
    }
    this.base = base;
    this.kick();
  }

  private kick() {
    if (!this.raf && this.visible) this.raf = requestAnimationFrame((t) => this.draw(t));
  }

  private draw(t: number) {
    this.raf = 0;
    if (!this.base || !this.visible) return;
    const ctx = this.ctx;
    const dpr = this.canvas.width / Math.max(1, this.el.clientWidth);
    const w = this.el.clientWidth;
    const hh = this.el.clientHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.scale(dpr, dpr);

    let p = this.pointer;
    const touch = isMobileLayout();
    if (!p && touch) {
      // подсветка медленно движется сама
      this.auto = t / 1000;
      p = {
        x: w / 2 + Math.cos(this.auto * 0.35) * w * 0.28,
        y: hh / 2 + Math.sin(this.auto * 0.5) * hh * 0.22,
      };
    }
    if (!p) {
      p = { x: w * 0.62, y: hh * 0.38 };
    }
    const x0 = Math.max(STEP / 2, Math.floor((p.x - RADIUS) / STEP) * STEP + STEP / 2);
    const y0 = Math.max(STEP / 2, Math.floor((p.y - RADIUS) / STEP) * STEP + STEP / 2);
    for (let y = y0; y < Math.min(hh, p.y + RADIUS); y += STEP) {
      for (let x = x0; x < Math.min(w, p.x + RADIUS); x += STEP) {
        const d = Math.hypot(x - p.x, y - p.y) / RADIUS;
        if (d >= 1) continue;
        const k = Math.pow(1 - d, 1.6);
        const r = 1.1 + k * 2.6;
        // объёмная точка: тень снизу-справа, блик сверху-слева
        ctx.fillStyle = `rgba(0,0,0,${0.6 * k})`;
        ctx.beginPath();
        ctx.arc(x + 0.6, y + 0.8, r, 0, Math.PI * 2);
        ctx.fill();
        const l = Math.round(40 + k * 150);
        ctx.fillStyle = `rgb(${l},${l},${l + 4})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (k > 0.15) {
          ctx.fillStyle = `rgba(255,255,255,${0.75 * k})`;
          ctx.beginPath();
          ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (touch && !this.pointer) this.kick();
  }
}
