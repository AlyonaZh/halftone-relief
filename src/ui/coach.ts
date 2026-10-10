// Подсказка первого входа у кнопки «Звук» слайдера «Сила» (docs/changes-v6.md §3).
// Показывается один раз за всё время: есть звук, ни одной реакции, подсказку ещё не закрывали.
import { PARAM_KEYS } from '../defaults';
import { app, coachDismissed, dismissCoach, onCoachDismiss, reactiveSource, settings } from '../state';
import { ICON, h, isMobileLayout, svg } from './dom';
import type { Slider } from './slider';

export class CoachMark {
  private card: HTMLDivElement;
  private visible = false;

  constructor(
    private slider: Slider,
    /** Раскрыть раздел, в котором стоит слайдер (если свёрнут) */
    private reveal: () => void,
  ) {
    const close = h('button', {
      class: 'coach-x',
      type: 'button',
      'aria-label': 'Закрыть подсказку',
      onclick: () => dismissCoach(),
    }, svg(ICON.close));
    this.card = h('div', { class: 'coach', role: 'dialog', 'aria-labelledby': 'coach-title', hidden: true },
      h('div', { class: 'coach-top' }, h('div', { class: 'coach-title', id: 'coach-title' }, 'Оживите картинку звуком'), close),
      h('p', { class: 'coach-text' },
        'Нажмите «Звук» рядом с любым параметром, и он начнёт меняться в такт музыке. Выберите, на что реагировать: басы, середину, верха или бочку.'),
    );
    slider.head.append(this.card);

    const update = () => this.update();
    app.subscribe(update);
    settings.subscribe(update);
    onCoachDismiss(update);
    // мобильная шторка: ждём, пока её откроют
    new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['data-sheet'] });
    window.addEventListener('resize', () => this.visible && this.place());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.visible) dismissCoach();
    });
    update();
  }

  private shouldShow() {
    if (coachDismissed()) return false;
    const a = app.get();
    if (a.exportOpen || reactiveSource(a) === null) return false;
    const mods = settings.get().mods;
    if (PARAM_KEYS.some((k) => mods[k].source)) return false;
    if (isMobileLayout() && document.documentElement.dataset.sheet === 'collapsed') return false;
    // видимость кнопки «Звук» не проверяем: панель может обновиться позже подсказки
    return !!this.slider.pill;
  }

  private update() {
    const show = this.shouldShow();
    if (show === this.visible) return;
    this.visible = show;
    this.card.hidden = !show;
    this.slider.pill?.classList.toggle('hl', show);
    if (show) {
      this.reveal();
      requestAnimationFrame(() => {
        this.place();
        this.card.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  /** Стрелка указывает на центр кнопки «Звук» */
  private place() {
    const pill = this.slider.pill;
    if (!pill) return;
    const cr = this.card.getBoundingClientRect();
    const pr = pill.getBoundingClientRect();
    const x = pr.left + pr.width / 2 - cr.left;
    this.card.style.setProperty('--arrow-x', `${Math.max(16, Math.min(cr.width - 16, x))}px`);
  }
}
