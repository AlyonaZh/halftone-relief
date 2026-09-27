// Мини-хелпер для DOM и набор иконок.

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: (Child | Child[])[]) {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function svg(markup: string, cls = 'ico'): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = markup;
  return s;
}

const S = (d: string, vb = '0 0 16 16', extra = '') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICON = {
  chevronDown: S('<path d="M4 6l4 4 4-4"/>'),
  chevronRight: S('<path d="M6 4l4 4-4 4"/>'),
  close: S('<path d="M4 4l8 8M12 4l-8 8"/>'),
  plus: S('<path d="M8 3v10M3 8h10"/>'),
  shuffle: S('<path d="M2.5 4.5h2.2c1 0 1.9.5 2.4 1.3l2.8 4.4c.5.8 1.4 1.3 2.4 1.3h1.2M2.5 11.5h2.2c1 0 1.9-.5 2.4-1.3M9.9 5.8c.5-.8 1.4-1.3 2.4-1.3h1.2M12 2.8l1.7 1.7L12 6.2M12 9.8l1.7 1.7-1.7 1.7"/>'),
  upload: S('<path d="M8 11V2.5M4.5 6L8 2.5 11.5 6M3 13.5h10"/>'),
  uploadBig: S('<path d="M12 16V4M7 9l5-5 5 5M4.5 20h15"/>', '0 0 24 24', 'stroke-width="1.6"'),
  lock: S('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>'),
  music: S('<path d="M6 12.2V3.5l7-1.5v8.7"/><circle cx="4.5" cy="12.2" r="1.6"/><circle cx="11.5" cy="10.7" r="1.6"/>'),
  swap: S('<path d="M3 5.5h9.5M10.5 3.5l2 2-2 2M13 10.5H3.5M5.5 8.5l-2 2 2 2"/>'),
  more: `<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>`,
  play: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.2v9.6c0 .5.5.8.9.5l7.3-4.8c.4-.3.4-.8 0-1.1L5.9 2.7c-.4-.3-.9 0-.9.5z"/></svg>`,
  pause: `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="2.6" height="10" rx=".8"/><rect x="9.4" y="3" width="2.6" height="10" rx=".8"/></svg>`,
  check: S('<path d="M4 8.3l2.6 2.6L12 5.5"/>', '0 0 16 16', 'stroke-width="1.8"'),
  freq: S('<path d="M2.5 6.5v3M5 4.5v7M7.5 6v4M10 3.5v9M12.5 6.5v3"/>'),
  copy: S('<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5"/><path d="M10.5 5.5V4.5A1.5 1.5 0 009 3H4.5A1.5 1.5 0 003 4.5V9a1.5 1.5 0 001.5 1.5h1"/>'),
};

export function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const isMobileLayout = () => window.matchMedia('(max-width: 1023.98px)').matches;
