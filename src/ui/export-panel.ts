// Панель экспорта: фото (PNG/SVG), видео (MP4/WebM, звук, фрагмент) и PNG кадра (SPEC §8).
import { pickMime, type VideoFormat } from '../export/record';
import { isTouchDevice } from '../export/save';
import { app, reactiveSource } from '../state';
import { ICON, fmtTime, h, svg } from './dom';

export type SoundChoice = 'file' | 'video' | 'none';

export interface ExportActions {
  close(): void;
  startRecording(format: VideoFormat, sound: SoundChoice): void;
  cancelRecording(): void;
  downloadVideo(): void;
  recordAgain(): void;
  exportPng(): Promise<void>;
  exportSvg(): Promise<void>;
}

export interface RecordingSummary {
  format: VideoFormat;
  duration: number;
  sound: SoundChoice;
}

const SOUND_LABEL: Record<SoundChoice, string> = {
  file: 'звук из аудиофайла',
  video: 'звук из видео',
  none: 'без звука',
};

export class ExportPanel {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private footer: HTMLDivElement;
  private what: 'video' | 'png' = 'video';
  private format: VideoFormat = 'mp4';
  private sound: SoundChoice = 'none';
  private photoFormat: 'png' | 'svg' = 'png';
  private busy = false;
  private progress = { el: null as HTMLElement | null, time: null as HTMLElement | null };
  summary: RecordingSummary | null = null;

  constructor(private actions: ExportActions) {
    this.body = h('div', { class: 'exp-body' });
    this.footer = h('div', { class: 'exp-footer' });
    let startY = 0;
    const head = h('div', { class: 'exp-head' },
      h('span', { class: 'sheet-grip', 'aria-hidden': 'true' }),
      h('h2', { class: 'sec-title' }, 'Экспорт'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть экспорт', onclick: () => this.actions.close() },
        svg(ICON.close)),
    );
    // свайп вниз закрывает панель на телефоне
    head.addEventListener('touchstart', (e) => (startY = e.touches[0].clientY), { passive: true });
    head.addEventListener('touchend', (e) => {
      if (e.changedTouches[0].clientY - startY > 80 && app.get().exportStage !== 'recording') this.actions.close();
    });
    this.el = h('div', { class: 'export-panel', role: 'dialog', 'aria-label': 'Экспорт', hidden: true },
      head, this.body, this.footer);
    app.subscribe((s, prev) => {
      if (s.exportOpen && !prev.exportOpen) this.onOpen();
      if (
        s.exportOpen !== prev.exportOpen ||
        s.exportStage !== prev.exportStage ||
        s.media !== prev.media ||
        s.audioFile !== prev.audioFile ||
        s.inPoint !== prev.inPoint ||
        s.outPoint !== prev.outPoint ||
        s.videoHasAudio !== prev.videoHasAudio
      ) {
        this.render();
      }
    });
  }

  private onOpen() {
    const s = app.get();
    this.what = 'video';
    // По умолчанию MP4, если поддерживается, иначе WebM
    this.format = pickMime('mp4') ? 'mp4' : 'webm';
    const r = reactiveSource(s);
    this.sound = r ?? 'none';
    if (this.sound === 'file' && !s.audioFile) this.sound = 'none';
  }

  private seg<T extends string>(items: [T, string, boolean?][], value: T, onPick: (v: T) => void, disabled = false) {
    return h('div', { class: 'seg' }, items.map(([v, label, off]) =>
      h('button', {
        type: 'button',
        class: 'seg-btn' + (v === value ? ' on' : ''),
        disabled: disabled || !!off,
        'aria-pressed': String(v === value),
        onclick: () => onPick(v),
      }, label)));
  }

  render() {
    const s = app.get();
    this.el.hidden = !s.exportOpen;
    if (!s.exportOpen) return;
    this.body.replaceChildren();
    this.footer.replaceChildren();
    this.progress = { el: null, time: null };
    const recording = s.exportStage === 'recording';
    const done = s.exportStage === 'done';
    const locked = recording || done;
    const mobile = isTouchDevice();

    // Фото без аудио — PNG / SVG
    if (!s.timeline) {
      this.body.append(
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Формат'),
          this.seg<'png' | 'svg'>([['png', 'PNG'], ['svg', 'SVG']], this.photoFormat, (v) => {
            this.photoFormat = v;
            this.render();
          })),
        h('p', { class: 'hint' },
          'PNG сохранится в исходном размере со всеми эффектами. SVG содержит точки растра и контуры — без объёма и бликов.'),
      );
      this.footer.append(this.primary('Скачать', async () => {
        this.busy = true;
        this.render();
        try {
          await (this.photoFormat === 'png' ? this.actions.exportPng() : this.actions.exportSvg());
        } finally {
          this.busy = false;
          this.render();
        }
      }));
      return;
    }

    // Видео или фото + аудио
    this.body.append(
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Что сохранить'),
        this.seg<'video' | 'png'>([['video', 'Видео'], ['png', 'PNG кадра']], this.what, (v) => {
          this.what = v;
          this.render();
        }, locked)),
    );

    if (this.what === 'png') {
      this.body.append(h('p', { class: 'hint' }, 'PNG сохранится в исходном размере — текущий кадр на таймлайне.'));
      this.footer.append(this.primary('Скачать', async () => {
        this.busy = true;
        this.render();
        try {
          await this.actions.exportPng();
        } finally {
          this.busy = false;
          this.render();
        }
      }));
      return;
    }

    const mp4 = !!pickMime('mp4');
    const webm = !!pickMime('webm');
    this.body.append(
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Формат'),
        this.seg<VideoFormat>([['mp4', 'MP4', !mp4], ['webm', 'WebM', !webm]], this.format, (v) => {
          this.format = v;
          this.render();
        }, locked),
        !mp4 ? h('p', { class: 'hint small' }, 'Ваш браузер не умеет записывать MP4 — используйте WebM или Chrome/Safari') : null,
      ),
      h('div', { class: 'frag' }, h('span', null, 'Фрагмент'),
        h('span', { class: 'mono' }, `${fmtTime(s.inPoint)} – ${fmtTime(s.outPoint)}`)),
    );

    const opts: [SoundChoice, string, boolean][] = [];
    if (s.audioFile) opts.push(['file', 'Из аудиофайла', false]);
    if (s.media === 'video') opts.push(['video', 'Из видео', !s.videoHasAudio]);
    opts.push(['none', 'Без звука', false]);
    if (!opts.some(([v, , off]) => v === this.sound && !off)) this.sound = 'none';
    this.body.append(
      h('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Звук' }, h('div', { class: 'field-label' }, 'Звук'),
        opts.map(([v, label, off]) =>
          h('label', { class: 'radio' + (v === this.sound ? ' on' : '') + (off || locked ? ' disabled' : '') },
            h('input', {
              type: 'radio',
              name: 'exp-sound',
              checked: v === this.sound,
              disabled: off || locked,
              onchange: () => {
                this.sound = v;
                this.render();
              },
            }),
            h('span', { class: 'radio-dot' }),
            label,
          ))),
    );

    const total = Math.max(0, s.outPoint - s.inPoint);
    if (recording) {
      const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
      const time = h('div', { class: 'rec-time' });
      this.progress = { el: bar, time };
      this.footer.append(
        h('div', { class: 'rec-status' }, h('span', { class: 'rec-dot' }), 'Идёт запись'),
        time,
        bar,
        h('p', { class: 'hint' }, mobile
          ? 'Не блокируйте экран и не сворачивайте браузер, иначе запись прервётся'
          : 'Не закрывайте и не сворачивайте вкладку, иначе запись прервётся.'),
        h('button', { class: 'outline-btn wide tall', type: 'button', onclick: () => this.actions.cancelRecording() }, 'Отменить'),
      );
      this.frame(0, total);
    } else if (done && this.summary) {
      const sm = this.summary;
      this.footer.append(
        h('div', { class: 'done-status' }, h('span', { class: 'done-check' }, svg(ICON.check)), 'Видео готово'),
        h('div', { class: 'mono dim summary' },
          `${sm.format.toUpperCase()} · ${fmtTime(sm.duration)} · ${SOUND_LABEL[sm.sound]}`),
        this.primary('Скачать файл', () => this.actions.downloadVideo()),
        h('button', { class: 'outline-btn wide tall', type: 'button', onclick: () => this.actions.recordAgain() }, 'Записать заново'),
      );
    } else {
      this.footer.append(
        h('p', { class: 'hint' },
          `Видео сохранится в исходном размере. Запись идёт в реальном времени и займёт ${fmtTime(total)} — не закрывайте вкладку.`),
        this.primary('Начать запись', () => this.actions.startRecording(this.format, this.sound), !mp4 && !webm),
      );
    }
  }

  private primary(label: string, onClick: () => void, disabled = false) {
    return h('button', {
      class: 'chrome-btn wide tall',
      type: 'button',
      disabled: disabled || this.busy,
      onclick: onClick,
    }, this.busy ? 'Готовим файл…' : label);
  }

  /** Прогресс записи */
  frame(elapsed: number, total: number) {
    if (!this.progress.el || !this.progress.time) return;
    const p = total > 0 ? Math.min(1, elapsed / total) : 0;
    (this.progress.el.firstChild as HTMLElement).style.width = `${p * 100}%`;
    this.progress.time.replaceChildren(
      h('span', null, fmtTime(elapsed)),
      h('span', { class: 'dim' }, ` / ${fmtTime(total)}`),
    );
  }
}
