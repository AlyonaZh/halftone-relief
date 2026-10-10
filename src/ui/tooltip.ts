// Всплывающие подсказки — общий тёмный стиль для всего интерфейса (docs/changes-v6.md §2).
// Наведение (только на устройствах с hover) или фокус с клавиатуры → через ~400 мс; уход → сразу.
// Текст дублируется для скринридеров через aria-describedby.

const DELAY = 400;
const canHover = window.matchMedia('(hover: hover)');

let tipEl: HTMLDivElement | null = null;
let timer = 0;
let current: HTMLElement | null = null;
let uid = 0;

function el(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.setAttribute('aria-hidden', 'true');
    tipEl.hidden = true;
    document.body.append(tipEl);
  }
  return tipEl;
}

// Описания для aria-describedby живут вне кнопок, чтобы не попасть в их доступное имя
let host: HTMLDivElement | null = null;
function descHost() {
  if (!host) {
    host = document.createElement('div');
    host.className = 'visually-hidden';
    document.body.append(host);
  }
  return host;
}

function show(target: HTMLElement) {
  const text = target.dataset.tip;
  if (!text || !target.isConnected) return;
  const t = el();
  t.textContent = text;
  t.hidden = false;
  const r = target.getBoundingClientRect();
  const tw = t.offsetWidth;
  const th = t.offsetHeight;
  const gap = 8;
  const cx = r.left + r.width / 2;
  const left = Math.min(window.innerWidth - tw - 8, Math.max(8, cx - tw / 2));
  const below = r.bottom + gap + th < window.innerHeight - 8;
  const top = below ? r.bottom + gap : r.top - gap - th;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
  t.style.setProperty('--arrow-x', `${Math.min(tw - 12, Math.max(12, cx - left))}px`);
  t.classList.toggle('above', !below);
  current = target;
}

export function hideTip() {
  clearTimeout(timer);
  current = null;
  if (tipEl) tipEl.hidden = true;
}

function schedule(target: HTMLElement) {
  clearTimeout(timer);
  timer = window.setTimeout(() => show(target), DELAY);
}

/** Подключить подсказку к элементу; текст меняется через setTip */
export function tooltip(target: HTMLElement, text = '') {
  const descId = `tip-${++uid}`;
  const desc = document.createElement('span');
  desc.id = descId;
  descHost().append(desc);
  target.setAttribute('aria-describedby', descId);
  setTip(target, text);
  target.addEventListener('mouseenter', () => {
    if (canHover.matches) schedule(target);
  });
  target.addEventListener('mouseleave', hideTip);
  target.addEventListener('focusin', () => {
    if (target.matches(':focus-visible')) schedule(target);
  });
  target.addEventListener('focusout', hideTip);
  target.addEventListener('pointerdown', hideTip);
}

export function setTip(target: HTMLElement, text: string) {
  if (target.dataset.tip === text) return;
  target.dataset.tip = text;
  const id = target.getAttribute('aria-describedby');
  const desc = id ? document.getElementById(id) : null;
  if (desc) desc.textContent = text;
  if (current === target) {
    if (text) show(target);
    else hideTip();
  }
}

window.addEventListener('scroll', hideTip, true);
window.addEventListener('resize', hideTip);
