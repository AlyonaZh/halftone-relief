// Многопроходный рендер эффекта. Один и тот же пайплайн рисует превью и экспорт в исходном размере.
import { CONST, type ParamKey, type Settings } from '../defaults';
import { Program, createTarget, deleteTarget, hexToRgb, type Target, type TexFormat } from './gl';
import { BLUR, COPY, FIELD, HALFTONE, SHADE, VERT, WARP } from './shaders';

export type SourceElement = HTMLImageElement | HTMLVideoElement;

export interface FrameParams {
  /** Итоговые значения параметров (с учётом аудиомодуляции) */
  p: Record<ParamKey, number>;
  s: Settings;
  seed: number;
  time: number;
}

interface TargetSet {
  w: number;
  h: number;
  field: Target;
  warp: Target;
  ht: Target;
  blurA: Target;
  blurB: Target;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private progs!: { field: Program; warp: Program; ht: Program; blur: Program; shade: Program; copy: Program };
  private vao!: WebGLVertexArrayObject;
  private srcTex: WebGLTexture | null = null;
  private src: SourceElement | null = null;
  srcW = 0;
  srcH = 0;
  private fmt!: TexFormat;
  private preview: TargetSet | null = null;
  readonly maxTexture: number;
  lost = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 не поддерживается');
    this.gl = gl;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.init();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.preview = null;
      this.srcTex = null;
      this.init();
      if (this.src) this.setSource(this.src, this.srcW, this.srcH);
    });
  }

  private init() {
    const gl = this.gl;
    const float = gl.getExtension('EXT_color_buffer_float');
    this.fmt = float
      ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
      : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    this.progs = {
      field: new Program(gl, VERT, FIELD),
      warp: new Program(gl, VERT, WARP),
      ht: new Program(gl, VERT, HALFTONE),
      blur: new Program(gl, VERT, BLUR),
      shade: new Program(gl, VERT, SHADE),
      copy: new Program(gl, VERT, COPY),
    };
    this.vao = gl.createVertexArray()!;
  }

  // ---------- Исходник ----------

  setSource(el: SourceElement, w: number, h: number) {
    const gl = this.gl;
    this.src = el;
    this.srcW = w;
    this.srcH = h;
    if (!this.srcTex) this.srcTex = gl.createTexture();
    this.uploadSource();
  }

  clearSource() {
    this.src = null;
    if (this.srcTex) this.gl.deleteTexture(this.srcTex);
    this.srcTex = null;
  }

  /** Загрузить текущий кадр (для видео — каждый новый кадр) */
  uploadSource() {
    const gl = this.gl;
    if (!this.src || !this.srcTex) return;
    if (this.src instanceof HTMLVideoElement && this.src.readyState < 2) return;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.src);
    } catch (e) {
      console.warn('texImage2D failed', e);
      return;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  get hasSource() {
    return !!this.src && !!this.srcTex;
  }

  // ---------- Цели рендера ----------

  private makeSet(w: number, h: number): TargetSet {
    const gl = this.gl;
    const [fw, fh] = fieldSize(w, h);
    return {
      w,
      h,
      field: createTarget(gl, fw, fh, this.fmt),
      warp: createTarget(gl, w, h, this.fmt, true),
      ht: createTarget(gl, w, h, this.fmt),
      blurA: createTarget(gl, w, h, this.fmt),
      blurB: createTarget(gl, w, h, this.fmt),
    };
  }

  private freeSet(s: TargetSet | null) {
    if (!s) return;
    for (const t of [s.field, s.warp, s.ht, s.blurA, s.blurB]) deleteTarget(this.gl, t);
  }

  private previewSet(w: number, h: number) {
    if (!this.preview || this.preview.w !== w || this.preview.h !== h) {
      this.freeSet(this.preview);
      this.preview = this.makeSet(w, h);
    }
    return this.preview;
  }

  // ---------- Проходы ----------

  private draw(target: Target | null, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private runPasses(set: TargetSet, fp: FrameParams, out: Target | null) {
    const gl = this.gl;
    const { w, h } = set;
    const { p, s } = fp;
    const scale = w / this.srcW; // px цели на px исходника
    const cell = Math.max(1.5, p.dotSize * scale);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // 1–2. Тон и искажение
    this.warpPasses(set.field, set.warp, fp);
    gl.bindTexture(gl.TEXTURE_2D, set.warp.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // 3–4. Порог и растр
    this.progs.ht
      .use()
      .tex('uTone', 0, set.warp.tex)
      .f('uRes', w, h)
      .f('uCell', cell)
      .f('uAngle', (CONST.gridAngleDeg * Math.PI) / 180)
      .f('uThr', p.threshold / 100)
      .f('uSoft', CONST.thresholdSoftness)
      .f('uRmax', CONST.dotMaxRadius)
      .f('uMerge', CONST.dotMerge)
      .f('uLod', Math.max(0, Math.log2(cell * 0.35)));
    this.draw(set.ht, w, h);

    // 5. Размытие поля высот (радиус от «Объёма») и тона (для контуров — из mip-уровней)
    const sigA = cell * (0.06 + 0.36 * p.volume);
    const sigB = Math.max(1.5, cell * 1.1);
    const lod = Math.max(0, Math.log2((sigB * 2.5) / 4 / 1.5));
    const blur = this.progs.blur.use().f('uSigA', sigA).f('uSigB', sigB);
    blur.tex('uTex', 0, set.ht.tex).tex('uLum', 1, set.warp.tex).i('uLumCh', 3).f('uLumLod', lod).f('uDir', 1 / w, 0);
    this.draw(set.blurA, w, h);
    blur.tex('uTex', 0, set.blurA.tex).tex('uLum', 1, set.blurA.tex).i('uLumCh', 1).f('uLumLod', 0).f('uDir', 0, 1 / h);
    this.draw(set.blurB, w, h);

    // 6–8. Свет, контуры, цвет
    const az = (CONST.lightAzimuthDeg * Math.PI) / 180;
    const el = (CONST.lightElevationDeg * Math.PI) / 180;
    // азимут 315° — сверху-слева (x вправо, y вверх)
    const L = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
    const mode = s.colorMode === 'bw' ? 0 : s.colorMode === 'tone' ? 1 : 2;
    this.progs.shade
      .use()
      .tex('uHT', 0, set.ht.tex)
      .tex('uBL', 1, set.blurB.tex)
      .tex('uTone', 2, set.warp.tex)
      .f('uRes', w, h)
      .f('uCell', cell)
      .f('uVolume', p.volume)
      .f('uGloss', p.gloss)
      .f('uLight', L[0], L[1], L[2])
      .f('uThr', p.threshold / 100)
      .f('uSoft', CONST.thresholdSoftness)
      .f('uContours', s.contoursOn ? 1 : 0)
      .f('uContourN', Math.round(p.contourCount))
      .f('uContourW', Math.max(0.5, p.contourWidth * scale))
      .i('uColorMode', mode)
      .i('uToneMode', s.toneMode === 'solid' ? 0 : 1)
      .f('uSolid', ...hexToRgb(s.solidColor))
      .f('uShadow', ...hexToRgb(s.shadowColor))
      .f('uLightCol', ...hexToRgb(s.lightColor))
      .f('uIntensity', p.intensity)
      .f('uInvert', s.invert ? 1 : 0);
    this.draw(out, out ? out.w : w, out ? out.h : h);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Поле смещения в низком разрешении + проход тона с искажением */
  private warpPasses(field: Target, warp: Target, fp: FrameParams) {
    const { p } = fp;
    const w = warp.w;
    const h = warp.h;
    const freq = CONST.warpFreqMin + (CONST.warpFreqMax - CONST.warpFreqMin) * Math.pow(p.warpScale, 1.6);
    const seed = fp.seed;
    this.gl.bindVertexArray(this.vao);
    this.progs.field
      .use()
      .f('uAspect', w / h)
      .f('uFreq', freq)
      .f('uTime', fp.time * CONST.warpFlow)
      .f('uSeed', (seed * 13.37) % 97, (seed * 7.77) % 89, (seed * 3.11) % 83);
    this.draw(field, field.w, field.h);
    this.progs.warp
      .use()
      .tex('uSrc', 0, this.srcTex!)
      .tex('uField', 1, field.tex)
      .f('uAspect', w / h)
      .f('uAmp', p.warpStrength * CONST.warpMaxAmp)
      .f('uContrast', CONST.contrast)
      .f('uGamma', CONST.gamma);
    this.draw(warp, w, h);
  }

  /** Рендер превью прямо в canvas (размер canvas задаётся снаружи) */
  render(fp: FrameParams) {
    if (!this.hasSource || this.lost) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.runPasses(this.previewSet(w, h), fp, null);
  }

  /** Рендер в отдельный фреймбуфер заданного размера, пиксели сверху вниз (для PNG) */
  renderPixels(w: number, h: number, fp: FrameParams): Uint8ClampedArray {
    const gl = this.gl;
    const set = this.makeSet(w, h);
    const out = createTarget(gl, w, h, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
    try {
      this.runPasses(set, fp, out);
      return this.readTarget(out);
    } finally {
      this.freeSet(set);
      deleteTarget(gl, out);
    }
  }

  /** Только проходы тона и искажения: rgb исходника + a = тон (для SVG) */
  renderTonePixels(w: number, h: number, fp: FrameParams): Uint8ClampedArray {
    const gl = this.gl;
    const warp = createTarget(gl, w, h, this.fmt);
    const out = createTarget(gl, w, h, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
    const [fw, fh] = fieldSize(w, h);
    const field = createTarget(gl, fw, fh, this.fmt);
    try {
      this.warpPasses(field, warp, fp);
      this.progs.copy.use().tex('uTex', 0, warp.tex);
      this.draw(out, w, h);
      return this.readTarget(out);
    } finally {
      deleteTarget(gl, field);
      deleteTarget(gl, warp);
      deleteTarget(gl, out);
    }
  }

  private readTarget(t: Target): Uint8ClampedArray {
    const gl = this.gl;
    const { w, h } = t;
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // WebGL отдаёт строки снизу вверх — переворачиваем
    const out = new Uint8ClampedArray(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      out.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    return out;
  }
}

/** Поле искажения гладкое — хватает ~1/6 разрешения */
function fieldSize(w: number, h: number): [number, number] {
  const k = Math.min(1, Math.max(96 / Math.min(w, h), 1 / 6));
  return [Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k))];
}
