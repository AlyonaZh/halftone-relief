// Web Audio: маршрутизация звука, анализ НЧ/СЧ/ВЧ и детектор кика (SPEC §6).
import { AUDIO, type AudioSource } from '../defaults';

export type SoundSource = 'file' | 'video';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private energyHist: number[] = [];
  private fluxHist: number[] = [];
  private sinceKick = 1;

  private els: Record<SoundSource, HTMLMediaElement | null> = { file: null, video: null };
  private nodes: Record<SoundSource, MediaElementAudioSourceNode | null> = { file: null, video: null };
  private gains: Record<SoundSource, GainNode | null> = { file: null, video: null };
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private recordFrom: SoundSource | null = null;

  private reactive: SoundSource | null = null;
  readonly levels: Record<AudioSource, number> = { low: 0, mid: 0, high: 0, kick: 0 };

  /** Создать/разбудить AudioContext — только из обработчика жеста пользователя (iOS) */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      const an = this.ctx.createAnalyser();
      an.fftSize = AUDIO.fftSize;
      an.smoothingTimeConstant = 0;
      an.minDecibels = AUDIO.minDb;
      an.maxDecibels = AUDIO.maxDb;
      this.analyser = an;
      this.bins = new Uint8Array(an.frequencyBinCount);
      this.wire('file');
      this.wire('video');
      this.applyRouting();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setElement(kind: SoundSource, el: HTMLMediaElement | null) {
    const old = this.nodes[kind];
    if (old) {
      try {
        old.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.gains[kind]?.disconnect();
    this.nodes[kind] = null;
    this.gains[kind] = null;
    this.els[kind] = el;
    if (this.ctx) this.wire(kind);
    this.applyRouting();
  }

  private wire(kind: SoundSource) {
    const el = this.els[kind];
    if (!el || !this.ctx || this.nodes[kind]) return;
    try {
      const node = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      node.connect(gain);
      gain.connect(this.ctx.destination);
      this.nodes[kind] = node;
      this.gains[kind] = gain;
    } catch (e) {
      console.warn('createMediaElementSource failed', e);
    }
  }

  /** Источник реактивности; его же слышно в превью */
  setReactive(src: SoundSource | null) {
    this.reactive = src;
    this.applyRouting();
  }

  private applyRouting() {
    for (const k of ['file', 'video'] as SoundSource[]) {
      const g = this.gains[k];
      if (g) g.gain.value = this.reactive === k ? 1 : 0;
      const el = this.els[k];
      // до создания AudioContext элементы звучат напрямую
      if (el && !this.nodes[k]) el.muted = this.reactive !== k;
      if (el && this.nodes[k]) el.muted = false;
    }
    const an = this.analyser;
    if (!an) return;
    for (const k of ['file', 'video'] as SoundSource[]) {
      try {
        this.nodes[k]?.disconnect(an);
      } catch {
        /* не был подключён */
      }
    }
    if (this.reactive && this.nodes[this.reactive]) this.nodes[this.reactive]!.connect(an);
  }

  /** Обновить уровни. На паузе значения замирают. */
  update(dt: number, running: boolean) {
    const an = this.analyser;
    if (!running || !an || !this.ctx || !this.reactive) {
      if (!this.reactive) {
        this.levels.low = this.levels.mid = this.levels.high = this.levels.kick = 0;
      }
      return;
    }
    an.getByteFrequencyData(this.bins);
    const hz = this.ctx.sampleRate / an.fftSize;
    const band = (from: number, to: number) => {
      const a = Math.max(1, Math.floor(from / hz));
      const b = Math.min(this.bins.length - 1, Math.ceil(to / hz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += this.bins[i];
      return sum / ((b - a + 1) * 255);
    };
    const smooth = (cur: number, target: number, attack: number, release: number) => {
      const tau = target > cur ? attack : release;
      return cur + (target - cur) * (1 - Math.exp(-dt / tau));
    };
    const B = AUDIO.bands;
    this.levels.low = smooth(this.levels.low, band(B.low.from, B.low.to), B.low.attack, B.low.release);
    this.levels.mid = smooth(this.levels.mid, band(B.mid.from, B.mid.to), B.mid.attack, B.mid.release);
    this.levels.high = smooth(this.levels.high, band(B.high.from, B.high.to), B.high.attack, B.high.release);

    // Кик: рост энергии полосы 40–120 Гц (в дБ — значения анализатора логарифмические)
    // относительно минимума за последние ~70 мс + адаптивный порог.
    // Смена ноты у баса перекладывает энергию между бинами, но почти не меняет её сумму — кик не срабатывает.
    const e = band(AUDIO.kick.from, AUDIO.kick.to);
    const recent = this.energyHist;
    let floor = e;
    for (const v of recent) floor = Math.min(floor, v);
    recent.push(e);
    if (recent.length > 4) recent.shift();
    const onset = Math.max(0, e - floor);
    const hist = this.fluxHist;
    let mean = 0;
    for (const f of hist) mean += f;
    mean /= Math.max(1, hist.length);
    let varc = 0;
    for (const f of hist) varc += (f - mean) * (f - mean);
    const std = Math.sqrt(varc / Math.max(1, hist.length));
    hist.push(onset);
    if (hist.length > 60) hist.shift();
    this.sinceKick += dt;
    const thr = Math.max(AUDIO.kick.minRise, mean + 2 * std);
    if (onset > thr && this.sinceKick > 0.12 && e > 0.25) {
      this.levels.kick = 1;
      this.sinceKick = 0;
    } else {
      this.levels.kick *= Math.exp(-dt / AUDIO.kick.release);
    }
  }

  /** Аудиодорожка для записи видео */
  recordTrack(from: SoundSource | null): MediaStreamTrack | null {
    if (!from || !this.ensure()) return null;
    const node = this.nodes[from];
    if (!node) return null;
    if (!this.recordDest) this.recordDest = this.ctx!.createMediaStreamDestination();
    this.stopRecordTrack();
    node.connect(this.recordDest);
    this.recordFrom = from;
    return this.recordDest.stream.getAudioTracks()[0] ?? null;
  }

  stopRecordTrack() {
    if (this.recordFrom && this.recordDest) {
      try {
        this.nodes[this.recordFrom]?.disconnect(this.recordDest);
      } catch {
        /* ignore */
      }
    }
    this.recordFrom = null;
  }
}

export const audio = new AudioEngine();
