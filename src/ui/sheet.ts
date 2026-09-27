// Мобильная нижняя шторка настроек: свёрнута / половина / весь экран (SPEC §9).
import { h } from './dom';

export type SheetState = 'collapsed' | 'half' | 'full';

const ORDER: SheetState[] = ['collapsed', 'half', 'full'];

export class Sheet {
  readonly handle: HTMLDivElement;
  state: SheetState = 'half';
  onChange: ((s: SheetState) => void) | null = null;

  constructor(private host: HTMLElement, chips: { id: string; title: string }[], onChip: (id: string) => void) {
    const grip = h('button', {
      class: 'sheet-grip-btn',
      type: 'button',
      'aria-label': 'Развернуть или свернуть настройки',
      onclick: () => this.set(this.state === 'collapsed' ? 'half' : this.state === 'half' ? 'full' : 'collapsed'),
    }, h('span', { class: 'sheet-grip' }));
    const row = h('div', { class: 'sheet-chips' },
      chips.map((c) =>
        h('button', {
          type: 'button',
          class: 'chip',
          onclick: () => {
            if (this.state === 'collapsed') this.set('half');
            onChip(c.id);
          },
        }, c.title)));
    this.handle = h('div', { class: 'sheet-handle' }, grip, row);
    this.bindDrag(grip);
    this.apply();
  }

  set(s: SheetState) {
    this.state = s;
    this.apply();
    this.onChange?.(s);
  }

  private apply() {
    this.host.dataset.sheet = this.state;
    document.documentElement.dataset.sheet = this.state;
    this.host.style.removeProperty('transform');
  }

  private offsetFor(s: SheetState) {
    const hh = this.host.getBoundingClientRect().height;
    const vh = window.innerHeight;
    if (s === 'full') return 0;
    if (s === 'half') return Math.max(0, hh - vh * 0.5);
    return Math.max(0, hh - this.handle.getBoundingClientRect().height);
  }

  private bindDrag(grip: HTMLElement) {
    let startY = 0;
    let startOff = 0;
    let moved = false;
    let pid = -1;
    const target = this.handle;
    target.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.chip')) return;
      pid = e.pointerId;
      startY = e.clientY;
      startOff = this.offsetFor(this.state);
      moved = false;
      target.setPointerCapture(pid);
      this.host.classList.add('dragging');
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 5) moved = true;
      if (!moved) return;
      const off = Math.max(0, startOff + dy);
      this.host.style.transform = `translateY(${off}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = -1;
      this.host.classList.remove('dragging');
      if (!moved) {
        this.host.style.removeProperty('transform');
        return;
      }
      const off = Math.max(0, startOff + (e.clientY - startY));
      // ближайшее положение
      let best: SheetState = this.state;
      let bd = Infinity;
      for (const s of ORDER) {
        const d = Math.abs(this.offsetFor(s) - off);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      this.set(best);
      grip.blur();
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    // клик по ручке после перетаскивания не должен переключать состояние
    grip.addEventListener('click', (e) => {
      if (moved) {
        e.stopImmediatePropagation();
        moved = false;
      }
    }, true);
  }
}
