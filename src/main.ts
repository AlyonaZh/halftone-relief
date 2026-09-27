// Точка входа: раскладка, загрузка файлов, цикл рендера, воспроизведение, экспорт.
import './styles.css';
import { audio } from './audio/engine';
import { defaultSettings, LIMITS, PARAM_KEYS, PARAMS, RECORD, type ParamKey } from './defaults';
import { keepAwake, pickMime, VideoRecorder, type VideoFormat } from './export/record';
import { exportName, isTouchDevice, pixelsToPng, saveBlob } from './export/save';
import { buildSvg } from './export/svg';
import { Transport } from './media/transport';
import { detectKind, loadAudio, loadPhoto, loadVideo, MediaError, MSG, type LoadedPhoto, type LoadedVideo } from './media/validate';
import { Renderer, type FrameParams } from './render/pipeline';
import { app, reactiveSource, settings } from './state';
import { ICON, clamp, h, isMobileLayout, svg } from './ui/dom';
import { EmptyState } from './ui/empty';
import { ExportPanel, type SoundChoice } from './ui/export-panel';
import { SettingsPanel } from './ui/panel';
import { Sheet } from './ui/sheet';
import { Timeline } from './ui/timeline';

// ---------- Раскладка ----------

const root = document.getElementById('app')!;

const fileInput = h('input', {
  type: 'file',
  class: 'visually-hidden',
  tabindex: '-1',
  'aria-hidden': 'true',
  accept: 'image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.mov,.m4v,.mp4,.webm,.png,.jpg,.jpeg,.webp',
});
const audioInput = h('input', {
  type: 'file',
  class: 'visually-hidden',
  tabindex: '-1',
  'aria-hidden': 'true',
  accept: 'audio/*,.mp3,.wav,.m4a,.ogg',
});

const pickFile = () => fileInput.click();
const pickAudio = () => audioInput.click();

const exportBtn = h('button', { class: 'chrome-btn hdr-export', type: 'button', disabled: true, onclick: () => toggleExport() }, 'Экспорт');
const menu = h('div', { class: 'menu', hidden: true, role: 'menu' },
  h('button', { type: 'button', role: 'menuitem', onclick: () => { menu.hidden = true; resetSettings(); } }, 'Сбросить настройки'));
const header = h('header', { class: 'hdr' },
  h('div', { class: 'logo' }, 'HALFTONE/RELIEF'),
  h('nav', { class: 'hdr-actions' },
    h('button', { class: 'link-btn d-only', type: 'button', onclick: pickFile }, 'Загрузить фото или видео'),
    h('button', { class: 'link-btn d-only', type: 'button', onclick: () => resetSettings() }, 'Сбросить настройки'),
    h('span', { class: 'hdr-sep d-only' }),
    h('button', { class: 'icon-btn m-only', type: 'button', 'aria-label': 'Загрузить фото или видео', onclick: pickFile }, svg(ICON.upload)),
    h('div', { class: 'menu-wrap m-only' },
      h('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': 'Ещё',
        'aria-haspopup': 'menu',
        onclick: (e: Event) => { e.stopPropagation(); menu.hidden = !menu.hidden; },
      }, svg(ICON.more)),
      menu),
    exportBtn,
  ),
);
document.addEventListener('click', (e) => {
  if (!menu.hidden && !menu.contains(e.target as Node)) menu.hidden = true;
});

const canvas = h('canvas', { class: 'gl', 'aria-label': 'Превью эффекта', role: 'img' });
const recBadge = h('div', { class: 'rec-badge', hidden: true }, h('span', { class: 'rec-dot' }), h('span', { class: 'rec-text' }, 'REC 0:00'));
const canvasBox = h('div', { class: 'canvas-box' }, h('div', { class: 'canvas-frame' }, canvas, recBadge));
const msgText = h('p', { class: 'msg-text' });
const msgLayer = h('div', { class: 'msg-layer', hidden: true, role: 'alertdialog', 'aria-live': 'assertive' },
  h('div', { class: 'msg-card' }, msgText,
    h('button', { class: 'outline-btn', type: 'button', onclick: () => (msgLayer.hidden = true) }, 'Понятно')));
const loadingEl = h('div', { class: 'loading', hidden: true }, h('span', { class: 'spinner' }), 'Открываем файл…');

const timeline = new Timeline({
  togglePlay: () => togglePlay(),
  seek: (t) => seek(t),
  setRange: (a, b) => setRange(a, b),
});
const empty = new EmptyState(pickFile);
const viewer = h('div', { class: 'viewer', hidden: true }, canvasBox, timeline.el);
const stage = h('section', { class: 'stage' }, empty.el, viewer, loadingEl, msgLayer);

const panel = new SettingsPanel({
  addAudio: pickAudio,
  removeAudio: () => removeAudio(),
  shuffle: () => {
    app.set({ seed: Math.random() * 1000 });
  },
});
const exportPanel = new ExportPanel({
  close: () => closeExport(),
  startRecording: (f, s) => startRecording(f, s),
  cancelRecording: () => cancelRecording(),
  downloadVideo: () => downloadVideo(),
  recordAgain: () => {
    lastVideo = null;
    app.set({ exportStage: 'idle' });
  },
  exportPng: () => exportPng(),
  exportSvg: () => exportSvg(),
});
const side = h('aside', { class: 'side' });
const sheet = new Sheet(side, [
  { id: 'audio', title: 'Аудио' },
  { id: 'warp', title: 'Искажение' },
  { id: 'raster', title: 'Растр' },
  { id: 'relief', title: 'Рельеф' },
  { id: 'contours', title: 'Контуры' },
  { id: 'color', title: 'Цвет' },
], (id) => panel.reveal(id as never));
side.append(sheet.handle, panel.el);

const toastText = h('span', null);
const toastUndo = h('button', { class: 'toast-undo', type: 'button' }, 'Отменить');
const toast = h('div', { class: 'toast', hidden: true, role: 'status' }, toastText, h('span', { class: 'dim' }, '·'), toastUndo);
const dropHint = h('div', { class: 'drop-hint', hidden: true }, 'Отпустите файл');

root.append(
  header,
  h('main', { class: 'main' }, stage, side),
  exportPanel.el,
  toast,
  dropHint,
  fileInput,
  audioInput,
);

// ---------- Рендерер ----------

let renderer: Renderer | null = null;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  console.error(e);
}

const transport = new Transport();
let photo: LoadedPhoto | null = null;
let video: LoadedVideo | null = null;
let audioEl: HTMLAudioElement | null = null;
let audioUrl = '';
let dirty = true;
let videoFrameReady = false;
let previewCap = 1080; // длинная сторона превью на телефоне
const PREVIEW_MAX = 1800; // длинная сторона превью на десктопе — экспорт всё равно в исходном размере
let lastVideo: { blob: Blob; ext: string } | null = null;

interface Recording {
  size: [number, number];
  format: VideoFormat;
  sound: SoundChoice;
  recorder: VideoRecorder;
  startedAt: number;
  frames: number;
  checked: boolean;
}
let recording: Recording | null = null;

settings.subscribe(() => (dirty = true));
app.subscribe((s, prev) => {
  dirty = true;
  exportBtn.disabled = s.media === 'none';
  exportBtn.classList.toggle('active', s.exportOpen);
  root.classList.toggle('export-open', s.exportOpen);
  if (
    s.audioFile !== prev.audioFile ||
    s.useVideoSound !== prev.useVideoSound ||
    s.videoHasAudio !== prev.videoHasAudio ||
    s.media !== prev.media
  ) {
    audio.setReactive(reactiveSource(s));
  }
  empty.setVisible(s.media === 'none');
  viewer.hidden = s.media === 'none';
  loadingEl.hidden = !s.loading;
  if (s.media !== prev.media || s.timeline !== prev.timeline) requestAnimationFrame(layoutCanvas);
});

function showMessage(text: string) {
  msgText.textContent = text;
  msgLayer.hidden = false;
  (msgLayer.querySelector('button') as HTMLButtonElement).focus();
}

if (!renderer) {
  showMessage('Ваш браузер не поддерживает WebGL2 — эффект не может работать. Откройте сайт в свежем Chrome, Safari, Edge или Firefox.');
}

// ---------- Загрузка файлов ----------

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (f) openFile(f);
});
audioInput.addEventListener('change', () => {
  const f = audioInput.files?.[0];
  audioInput.value = '';
  if (f) addAudio(f);
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  dropHint.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropHint.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (f) openFile(f);
});

async function openFile(file: File) {
  if (recording || !renderer) return;
  const kind = detectKind(file);
  if (!kind) return showMessage(MSG.unsupported);
  if (kind === 'audio') {
    if (app.get().media === 'none') return showMessage(MSG.unsupported);
    return addAudio(file);
  }
  app.set({ loading: true });
  msgLayer.hidden = true;
  try {
    const loaded = kind === 'photo' ? await loadPhoto(file) : await loadVideo(file);
    if (Math.max(loaded.width, loaded.height) > renderer.maxTexture) {
      throw new MediaError(`Видеокарта этого устройства обрабатывает максимум ${renderer.maxTexture} px по стороне.`);
    }
    setMedia(loaded);
  } catch (e) {
    console.warn(e);
    showMessage(e instanceof MediaError ? e.message : kind === 'video' ? MSG.videoDecode : MSG.photoDecode);
  } finally {
    app.set({ loading: false });
  }
}

function teardownMedia() {
  transport.pause();
  if (video) {
    audio.setElement('video', null);
    video.el.pause();
    video.el.removeAttribute('src');
    video.el.load();
    URL.revokeObjectURL(video.url);
    video = null;
  }
  if (photo) {
    URL.revokeObjectURL(photo.url);
    photo = null;
  }
}

function setMedia(m: LoadedPhoto | LoadedVideo) {
  teardownMedia();
  if (m.kind === 'photo') {
    photo = m;
  } else {
    video = m;
    const v = m.el;
    v.loop = false;
    audio.setElement('video', v);
    const anyV = v as any;
    if (typeof anyV.requestVideoFrameCallback === 'function') {
      const cb = () => {
        videoFrameReady = true;
        if (video?.el === v) anyV.requestVideoFrameCallback(cb);
      };
      anyV.requestVideoFrameCallback(cb);
    }
    v.addEventListener('seeked', () => (videoFrameReady = true));
    v.addEventListener('loadeddata', () => (videoFrameReady = true));
  }
  renderer!.setSource(m.el, m.width, m.height);
  app.set({
    media: m.kind,
    srcWidth: m.width,
    srcHeight: m.height,
    videoHasAudio: m.kind === 'video' ? m.hasAudio : false,
    useVideoSound: false,
    seed: Math.random() * 1000,
    exportOpen: false,
    exportStage: 'idle',
  });
  configureTransport(true);
  lastVideo = null;
  dirty = true;
  layoutCanvas();
  if (m.kind === 'video') {
    m.el.currentTime = 0;
    // Chrome узнаёт о звуке в видео только при декодировании
    const check = () => {
      if (video?.el !== m.el) return;
      const bytes = (m.el as any).webkitAudioDecodedByteCount;
      if (typeof bytes === 'number' && bytes > 0 && !app.get().videoHasAudio) app.set({ videoHasAudio: true });
    };
    m.el.addEventListener('timeupdate', check);
  }
}

function configureTransport(reset: boolean) {
  const prevMaster = transport.master;
  if (video) {
    transport.master = video.el;
    transport.slave = audioEl;
  } else if (photo && audioEl) {
    transport.master = audioEl;
    transport.slave = null;
  } else {
    transport.master = null;
    transport.slave = null;
  }
  const hasTimeline = !!transport.master;
  const duration = transport.duration;
  if (reset || transport.master !== prevMaster) {
    transport.inPoint = 0;
    transport.outPoint = Math.min(duration, LIMITS.maxFragment);
    if (transport.master) transport.master.currentTime = 0;
  }
  app.set({
    timeline: hasTimeline,
    duration,
    inPoint: transport.inPoint,
    outPoint: transport.outPoint,
    playing: false,
  });
}

async function addAudio(file: File) {
  if (recording) return;
  if (app.get().media === 'none') return showMessage(MSG.unsupported);
  app.set({ loading: true });
  try {
    const a = await loadAudio(file);
    removeAudio(true);
    audioEl = a.el;
    audioUrl = a.url;
    audio.setElement('file', a.el);
    app.set({ audioFile: true, audioName: a.name, audioPeaks: a.peaks, useVideoSound: false });
    configureTransport(false);
  } catch (e) {
    console.warn(e);
    showMessage(e instanceof MediaError ? e.message : MSG.audioDecode);
  } finally {
    app.set({ loading: false });
  }
}

function removeAudio(silent = false) {
  if (!audioEl) return;
  transport.pause();
  audio.setElement('file', null);
  audioEl.pause();
  audioEl.removeAttribute('src');
  audioEl.load();
  URL.revokeObjectURL(audioUrl);
  audioEl = null;
  if (!silent) {
    app.set({ audioFile: false, audioName: '', audioPeaks: [], useVideoSound: false });
    configureTransport(false);
    if (!app.get().timeline && app.get().exportOpen) app.set({ exportStage: 'idle' });
  }
}

// ---------- Воспроизведение ----------

function togglePlay() {
  if (!transport.master || recording) return;
  audio.ensure(); // AudioContext — только после жеста пользователя (iOS)
  if (transport.playing) {
    transport.pause();
    app.set({ playing: false });
  } else {
    transport.play();
    app.set({ playing: true });
  }
}

function seek(t: number) {
  transport.seek(t);
  timeline.frame(t);
  dirty = true;
}

function setRange(inPoint: number, outPoint: number) {
  transport.inPoint = inPoint;
  transport.outPoint = outPoint;
  app.set({ inPoint, outPoint });
  const t = transport.time;
  if (t < inPoint || t > outPoint) seek(clamp(t, inPoint, outPoint));
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.code === 'Space' && !/INPUT|BUTTON|TEXTAREA|SELECT/.test(tag) && !(e.target as HTMLElement).isContentEditable) {
    if (app.get().timeline) {
      e.preventDefault();
      togglePlay();
    }
  }
  if (e.key === 'Escape') {
    if (!msgLayer.hidden) msgLayer.hidden = true;
    else if (app.get().exportOpen && !recording) closeExport();
  }
});

// ---------- Параметры кадра ----------

function modActive() {
  if (!reactiveSource()) return false;
  const m = settings.get().mods;
  return PARAM_KEYS.some((k) => m[k].source && m[k].depth > 0);
}

function effectiveParams(): Record<ParamKey, number> {
  const s = settings.get();
  const out = { ...s.params };
  if (!reactiveSource()) return out;
  for (const k of PARAM_KEYS) {
    const m = s.mods[k];
    if (!m.source || m.depth <= 0) continue;
    const d = PARAMS[k];
    out[k] = clamp(out[k] + m.depth * (d.max - d.min) * audio.levels[m.source], d.min, d.max);
  }
  return out;
}

function frameParams(p = effectiveParams()): FrameParams {
  const a = app.get();
  return { p, s: settings.get(), seed: a.seed, time: a.timeline ? transport.time : 0 };
}

// ---------- Размер холста ----------

function renderSize(): [number, number] {
  if (recording) return recording.size;
  const { srcWidth: sw, srcHeight: sh } = app.get();
  if (!sw || !sh) return [1, 1];
  let k: number;
  if (isMobileLayout() || isTouchDevice()) {
    k = Math.min(1, previewCap / Math.max(sw, sh));
  } else {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = parseFloat(canvas.style.width) || canvasBox.clientWidth;
    k = Math.min(1, (cssW * dpr) / sw, PREVIEW_MAX / Math.max(sw, sh));
  }
  return [Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k))];
}

function layoutCanvas() {
  const { srcWidth: sw, srcHeight: sh } = app.get();
  if (!sw || !sh || viewer.hidden) return;
  // превью вписывается в свободную область вместе с таймлайном под ним
  const cs = getComputedStyle(viewer);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const gap = parseFloat(cs.rowGap) || 0;
  const tl = timeline.el.hidden ? 0 : timeline.el.offsetHeight + gap;
  const bw = viewer.clientWidth - padX;
  const bh = viewer.clientHeight - padY - tl;
  if (bw <= 0 || bh <= 0) return;
  const k = Math.min(bw / sw, bh / sh);
  const w = Math.floor(sw * k);
  const hh = Math.floor(sh * k);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${hh}px`;
  canvasBox.style.height = `${hh}px`;
  timeline.el.style.width = `${Math.max(w, Math.min(bw, 320))}px`;
  applyCanvasSize();
}

function applyCanvasSize() {
  const [w, hh] = renderSize();
  if (canvas.width !== w || canvas.height !== hh) {
    canvas.width = w;
    canvas.height = hh;
    dirty = true;
  }
}

new ResizeObserver(() => layoutCanvas()).observe(viewer);

// ---------- Цикл ----------

let last = performance.now();
let fpsFrames = 0;
let fpsStart = 0;

function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
  last = now;
  if (!renderer) return;

  transport.tick();
  const playing = transport.playing;
  if (app.get().playing !== playing) app.set({ playing });
  audio.update(dt, playing);

  if (video && (videoFrameReady || (playing && typeof (video.el as any).requestVideoFrameCallback !== 'function'))) {
    renderer.uploadSource();
    videoFrameReady = false;
    dirty = true;
  }
  const mods = modActive();
  if (playing && (app.get().timeline || mods)) dirty = true;
  if (recording) dirty = true;

  const eff = effectiveParams();
  if (dirty && renderer.hasSource) {
    dirty = false;
    renderer.render(frameParams(eff));
    trackFps(now, playing);
    if (recording) recording.frames++;
  }
  if (mods) panel.frame(eff);
  if (app.get().timeline) timeline.frame(transport.time);
  if (recording) recordingTick(now);
}
requestAnimationFrame(loop);

/** На телефоне: при падении ниже 30 fps превью уменьшается до 720 px */
function trackFps(now: number, continuous: boolean) {
  if (!continuous || recording || previewCap <= 720 || !(isMobileLayout() || isTouchDevice())) {
    fpsFrames = 0;
    fpsStart = now;
    return;
  }
  fpsFrames++;
  if (now - fpsStart > 2000) {
    const fps = (fpsFrames * 1000) / (now - fpsStart);
    if (fps < 30) {
      previewCap = 720;
      applyCanvasSize();
    }
    fpsFrames = 0;
    fpsStart = now;
  }
}

// ---------- Сброс настроек ----------

let toastTimer = 0;
function resetSettings() {
  if (recording) return;
  const snapshot = settings.get();
  settings.set(defaultSettings());
  toastText.textContent = 'Настройки сброшены';
  toast.hidden = false;
  toastUndo.onclick = () => {
    settings.set(snapshot);
    toast.hidden = true;
  };
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 5000);
}

// ---------- Экспорт ----------

function toggleExport() {
  if (app.get().exportOpen) closeExport();
  else if (app.get().media !== 'none') app.set({ exportOpen: true, exportStage: lastVideo ? 'done' : 'idle' });
}

function closeExport() {
  if (recording) cancelRecording();
  app.set({ exportOpen: false });
}

const tick = () => new Promise((r) => setTimeout(r, 30));

async function exportPng() {
  if (!renderer) return;
  const { srcWidth: w, srcHeight: hh } = app.get();
  await tick();
  try {
    const px = renderer.renderPixels(w, hh, frameParams());
    const blob = await pixelsToPng(px, w, hh);
    await saveBlob(blob, exportName('png'));
  } catch (e) {
    console.error(e);
    showMessage('Не хватило памяти видеокарты, чтобы сохранить PNG в исходном размере. Закройте другие вкладки и попробуйте снова.');
  }
}

async function exportSvg() {
  if (!renderer) return;
  const { srcWidth: w, srcHeight: hh } = app.get();
  await tick();
  try {
    const fp = frameParams();
    const tone = renderer.renderTonePixels(w, hh, fp);
    const text = buildSvg(tone, w, hh, fp.p, fp.s);
    await saveBlob(new Blob([text], { type: 'image/svg+xml' }), exportName('svg'));
  } catch (e) {
    console.error(e);
    showMessage('Не получилось собрать SVG. Попробуйте увеличить размер точки.');
  }
}

function recordSize(): [number, number] {
  const { srcWidth: sw, srcHeight: sh, media } = app.get();
  let w = sw;
  let hh = sh;
  if (media === 'photo') {
    const long = Math.max(w, hh);
    const short = Math.min(w, hh);
    const k = Math.min(1, LIMITS.exportVideoMaxLong / long, LIMITS.exportVideoMaxShort / short);
    w = Math.round(w * k);
    hh = Math.round(hh * k);
  }
  // H.264 требует чётных размеров
  return [Math.max(2, w - (w % 2)), Math.max(2, hh - (hh % 2))];
}

async function startRecording(format: VideoFormat, sound: SoundChoice) {
  if (recording || !renderer || !transport.master) return;
  audio.ensure();
  const mime = pickMime(format);
  if (!mime) return showMessage('Ваш браузер не умеет записывать видео. Используйте свежий Chrome или Safari.');
  transport.pause();
  const rec: Recording = {
    size: recordSize(),
    format,
    sound,
    recorder: new VideoRecorder(),
    startedAt: 0,
    frames: 0,
    checked: false,
  };
  recording = rec;
  applyCanvasSize();
  app.set({ exportStage: 'recording', playing: false });
  await transport.seekAndWait(app.get().inPoint);
  if (recording !== rec) return;
  videoFrameReady = true;
  renderer.uploadSource();
  renderer.render(frameParams());
  transport.noLoop = true;
  transport.onEnd = () => finishRecording();
  try {
    const track = sound === 'none' ? null : audio.recordTrack(sound);
    rec.recorder.start(canvas, track, mime);
  } catch (e) {
    console.error(e);
    stopRecordingState();
    app.set({ exportStage: 'idle' });
    return showMessage('Не удалось начать запись в этом браузере. Попробуйте формат WebM или Chrome.');
  }
  rec.startedAt = performance.now();
  await transport.play();
  app.set({ playing: true });
  recBadge.hidden = false;
  if (isTouchDevice()) keepAwake(true);
}

function recordingTick(now: number) {
  const rec = recording!;
  const a = app.get();
  const elapsed = Math.max(0, transport.time - a.inPoint);
  exportPanel.frame(elapsed, a.outPoint - a.inPoint);
  (recBadge.lastChild as HTMLElement).textContent = `REC ${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
  // Проверка мощности телефона: ниже 24 fps в первые 2 секунды — стоп
  if (rec.startedAt && !rec.checked && now - rec.startedAt > 2000) {
    rec.checked = true;
    const fps = (rec.frames * 1000) / (now - rec.startedAt);
    if (isTouchDevice() && fps < RECORD.minMobileFps) {
      cancelRecording(
        'Телефону не хватает мощности для записи этого видео. Попробуйте более короткий или меньший ролик или запишите на компьютере',
      );
    }
  }
}

function stopRecordingState() {
  transport.noLoop = false;
  transport.onEnd = null;
  audio.stopRecordTrack();
  recBadge.hidden = true;
  recording = null;
  keepAwake(false);
  applyCanvasSize();
}

async function finishRecording() {
  const rec = recording;
  if (!rec) return;
  const a = app.get();
  stopRecordingState();
  transport.pause();
  try {
    const blob = await rec.recorder.stop();
    lastVideo = { blob, ext: rec.format };
    exportPanel.summary = { format: rec.format, duration: a.outPoint - a.inPoint, sound: rec.sound };
    app.set({ exportStage: 'done', playing: false });
  } catch (e) {
    console.error(e);
    app.set({ exportStage: 'idle', playing: false });
    showMessage('Запись не сохранилась. Попробуйте ещё раз.');
  }
}

function cancelRecording(message?: string) {
  const rec = recording;
  if (!rec) return;
  rec.recorder.cancel();
  stopRecordingState();
  transport.pause();
  app.set({ exportStage: 'idle', playing: false });
  if (message) showMessage(message);
}

function downloadVideo() {
  if (!lastVideo) return;
  saveBlob(lastVideo.blob, exportName(lastVideo.ext));
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && recording) {
    cancelRecording(
      isTouchDevice()
        ? 'Запись прервалась: браузер был свёрнут или экран заблокирован. Запустите запись заново.'
        : 'Запись прервалась: вкладка ушла в фон. Запустите запись заново и не сворачивайте вкладку.',
    );
  }
});

window.addEventListener('beforeunload', (e) => {
  if (recording) e.preventDefault();
});

// Поворот экрана / смена раскладки — пересчитать холст без потери состояния
window.matchMedia('(max-width: 1023.98px)').addEventListener('change', () => requestAnimationFrame(layoutCanvas));
sheet.onChange = () => requestAnimationFrame(layoutCanvas);

// ---------- Отладка (только dev-сервер) ----------
if (import.meta.env.DEV) {
  (window as any).__hr = {
    app,
    settings,
    renderPixels: (w?: number, hh?: number) => {
      const a = app.get();
      const W = w ?? a.srcWidth;
      const H = hh ?? a.srcHeight;
      return { px: renderer!.renderPixels(W, H, frameParams()), w: W, h: H };
    },
    levels: audio.levels,
    open: (f: File) => openFile(f),
    lastVideo: () => lastVideo,
    bench: (n = 30) => {
      const gl = renderer!.gl;
      const fp = frameParams();
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      renderer!.render(fp);
      sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        renderer!.render(fp);
        sync();
      }
      return (performance.now() - t0) / n;
    },
    svg: () => {
      const a = app.get();
      const fp = frameParams();
      const tone = renderer!.renderTonePixels(a.srcWidth, a.srcHeight, fp);
      return buildSvg(tone, a.srcWidth, a.srcHeight, fp.p, fp.s);
    },
  };
  // Калибровка: «псевдо-оригинал» из размытого референса и сравнение 1:1 (слева референс, справа рендер)
  (window as any).__calib = async (blurPx = 5) => {
    const img = new Image();
    img.src = '/reference/sample.png';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.filter = `blur(${blurPx}px)`;
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    await openFile(new File([blob], 'dog.png', { type: 'image/png' }));
  };
  (window as any).__cmp = async (x: number, y: number) => {
    let ov = document.getElementById('__ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = '__ov';
      ov.style.cssText = 'position:fixed;inset:0;z-index:999;background:#000;display:flex';
      document.body.appendChild(ov);
      ov.onclick = () => (ov!.hidden = true);
    }
    ov.replaceChildren();
    ov.hidden = false;
    const w = innerWidth / 2;
    const hh = innerHeight;
    const ref = new Image();
    ref.src = '/reference/sample.png';
    await ref.decode();
    const c1 = document.createElement('canvas');
    c1.width = w;
    c1.height = hh;
    c1.getContext('2d')!.drawImage(ref, -x, -y);
    const r = (window as any).__hr.renderPixels();
    const tmp = document.createElement('canvas');
    tmp.width = r.w;
    tmp.height = r.h;
    tmp.getContext('2d')!.putImageData(new ImageData(r.px, r.w, r.h), 0, 0);
    const c2 = document.createElement('canvas');
    c2.width = w;
    c2.height = hh;
    c2.getContext('2d')!.drawImage(tmp, -x, -y);
    ov.append(c1, c2);
  };
}
