// Экспорт SVG: точки растра (<circle>) и изолинии (<path>) на CPU. Без объёма и бликов (SPEC §8).
import { CONST, type ParamKey, type Settings } from '../defaults';
import { hexToRgb } from '../render/gl';

const INK = 0.12;
const LINE = 0.06;

type RGB = [number, number, number];

function colorize(g: number, s: Settings, intensity: number, orig?: RGB): RGB {
  let c: RGB = [g, g, g];
  if (s.colorMode === 'tone') {
    let t: RGB;
    if (s.toneMode === 'solid') {
      const k = hexToRgb(s.solidColor);
      t = [g * k[0], g * k[1], g * k[2]];
    } else {
      const a = hexToRgb(s.shadowColor);
      const b = hexToRgb(s.lightColor);
      t = [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g];
    }
    c = c.map((v, i) => v + (t[i] - v) * intensity) as RGB;
  } else if (s.colorMode === 'orig' && orig) {
    const lo = 0.2126 * orig[0] + 0.7152 * orig[1] + 0.0722 * orig[2];
    const k = 1.25 * intensity * (0.35 + 0.65 * g);
    c = c.map((v, i) => Math.min(1, Math.max(0, v + (orig[i] - lo) * k))) as RGB;
  }
  if (s.invert) c = c.map((v) => 1 - v) as RGB;
  return c;
}

const hex = (c: RGB) =>
  '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

/**
 * @param tone пиксели прохода «тон + искажение» сверху вниз: rgb исходника, a = тон
 */
export function buildSvg(
  tone: Uint8ClampedArray,
  w: number,
  h: number,
  p: Record<ParamKey, number>,
  s: Settings,
): string {
  const thr = p.threshold / 100;
  const soft = CONST.thresholdSoftness;
  const cell = p.dotSize;
  const ang = (CONST.gridAngleDeg * Math.PI) / 180;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const ssx = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const darkness = (l: number) => (1 - Math.min(1, Math.max(0, l / Math.max(thr, 1e-3)))) * (1 - ssx(thr - soft, thr, l));

  // Координаты как в шейдере: y вверх, начало — левый нижний угол
  const sample = (x: number, y: number, ch: number) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(h - 1, Math.max(0, Math.round(h - 1 - y)));
    return tone[(yi * w + xi) * 4 + ch] / 255;
  };
  const sampleAvg = (x: number, y: number, ch: number) => {
    const o = cell * 0.18;
    let sum = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) sum += sample(x + i * o, y + j * o, ch);
    return sum / 9;
  };

  const paper = colorize(1, s, p.intensity);
  const ink = colorize(INK, s, p.intensity);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="${hex(paper)}"/>`,
    `<g id="halftone" fill="${hex(ink)}">`,
  );

  // Сетка в повёрнутых координатах: q = R^T p / cell
  const corners = [
    [0, 0], [w, 0], [0, h], [w, h],
  ].map(([x, y]) => [(ca * x + sa * y) / cell, (-sa * x + ca * y) / cell]);
  const qx0 = Math.floor(Math.min(...corners.map((c) => c[0]))) - 1;
  const qx1 = Math.ceil(Math.max(...corners.map((c) => c[0]))) + 1;
  const qy0 = Math.floor(Math.min(...corners.map((c) => c[1]))) - 1;
  const qy1 = Math.ceil(Math.max(...corners.map((c) => c[1]))) + 1;
  const rmax = CONST.dotMaxRadius * cell;
  const origMode = s.colorMode === 'orig';
  const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

  for (let j = qy0; j <= qy1; j++) {
    for (let i = qx0; i <= qx1; i++) {
      const cx = (i + 0.5) * cell;
      const cy = (j + 0.5) * cell;
      const x = ca * cx - sa * cy;
      const y = sa * cx + ca * cy;
      if (x < -rmax || y < -rmax || x > w + rmax || y > h + rmax) continue;
      const dk = darkness(sampleAvg(x, y, 3));
      if (dk <= 0.002) continue;
      const r = rmax * Math.pow(dk, 0.6);
      if (r < 0.3) continue;
      let fill = '';
      if (origMode) {
        const o: RGB = [sampleAvg(x, y, 0), sampleAvg(x, y, 1), sampleAvg(x, y, 2)];
        fill = ` fill="${hex(colorize(INK, s, p.intensity, o))}"`;
      }
      out.push(`<circle cx="${f1(x)}" cy="${f1(h - y)}" r="${f1(r)}"${fill}/>`);
    }
  }
  out.push('</g>');

  if (s.contoursOn) {
    const lineCol = colorize(LINE, s, p.intensity);
    out.push(
      `<g id="contours" fill="none" stroke="${hex(lineCol)}" stroke-width="${f1(p.contourWidth)}" stroke-linejoin="round" stroke-linecap="round">`,
    );
    for (const d of contourPaths(tone, w, h, cell, thr, Math.round(p.contourCount))) out.push(`<path d="${d}"/>`);
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

/** Изолинии размытого тона — marching squares, сегменты склеиваются в полилинии */
function contourPaths(tone: Uint8ClampedArray, w: number, h: number, cell: number, thr: number, n: number): string[] {
  const ds = Math.max(1, Math.ceil(Math.max(w, h) / 1400));
  const gw = Math.ceil(w / ds);
  const gh = Math.ceil(h / ds);
  const f = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const px = Math.min(w - 1, x * ds + (ds >> 1));
      const py = Math.min(h - 1, y * ds + (ds >> 1));
      f[y * gw + x] = tone[(py * w + px) * 4 + 3] / 255;
    }
  }
  // Гаусс ≈ три прохода box-blur
  const sigma = Math.max(1.5, cell * 1.1) / ds;
  const rad = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  const tmp = new Float32Array(f.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(f, tmp, gw, gh, rad, true);
    boxBlur(tmp, f, gw, gh, rad, false);
  }
  const paths: string[] = [];
  for (let k = 1; k <= n; k++) {
    const level = (k * thr) / (n + 1);
    paths.push(...marching(f, gw, gh, level, ds));
  }
  return paths;
}

function boxBlur(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horiz: boolean) {
  const len = horiz ? w : h;
  const lines = horiz ? h : w;
  const norm = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const idx = (i: number) => {
      const c = Math.min(len - 1, Math.max(0, i));
      return horiz ? l * w + c : c * w + l;
    };
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[idx(i)];
    for (let i = 0; i < len; i++) {
      dst[idx(i)] = acc * norm;
      acc += src[idx(i + r + 1)] - src[idx(i - r)];
    }
  }
}

function marching(f: Float32Array, gw: number, gh: number, level: number, ds: number): string[] {
  // ребро: горизонтальное (x,y)-(x+1,y) → 2*(y*gw+x), вертикальное (x,y)-(x,y+1) → 2*(y*gw+x)+1
  const pts = new Map<number, [number, number]>();
  const adj = new Map<number, number[]>();
  const point = (e: number): [number, number] => {
    let pt = pts.get(e);
    if (pt) return pt;
    const base = e >> 1;
    const x = base % gw;
    const y = (base - x) / gw;
    const a = f[base];
    if (e & 1) {
      const b = f[base + gw];
      const t = (level - a) / (b - a || 1e-9);
      pt = [x, y + t];
    } else {
      const b = f[base + 1];
      const t = (level - a) / (b - a || 1e-9);
      pt = [x + t, y];
    }
    pts.set(e, pt);
    return pt;
  };
  const link = (e1: number, e2: number) => {
    point(e1);
    point(e2);
    (adj.get(e1) ?? adj.set(e1, []).get(e1)!).push(e2);
    (adj.get(e2) ?? adj.set(e2, []).get(e2)!).push(e1);
  };
  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      const i = y * gw + x;
      const a = f[i] >= level ? 1 : 0;
      const b = f[i + 1] >= level ? 1 : 0;
      const c = f[i + gw + 1] >= level ? 1 : 0;
      const d = f[i + gw] >= level ? 1 : 0;
      const code = a | (b << 1) | (c << 2) | (d << 3);
      if (code === 0 || code === 15) continue;
      const top = 2 * i;
      const bottom = 2 * (i + gw);
      const left = 2 * i + 1;
      const right = 2 * (i + 1) + 1;
      switch (code) {
        case 1: case 14: link(top, left); break;
        case 2: case 13: link(top, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(right, bottom); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, bottom); break;
        case 5: case 10: {
          const center = (f[i] + f[i + 1] + f[i + gw] + f[i + gw + 1]) / 4 >= level ? 1 : 0;
          if ((code === 5) === !!center) {
            link(top, right);
            link(left, bottom);
          } else {
            link(top, left);
            link(right, bottom);
          }
          break;
        }
      }
    }
  }
  const used = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const out: string[] = [];
  const fmt = (e: number) => {
    const [x, y] = pts.get(e)!;
    return `${((x + 0.5) * ds).toFixed(1)} ${((y + 0.5) * ds).toFixed(1)}`;
  };
  const walk = (start: number) => {
    const chain = [start];
    let cur = start;
    for (;;) {
      const next = (adj.get(cur) ?? []).find((n) => !used.has(key(cur, n)));
      if (next === undefined) break;
      used.add(key(cur, next));
      chain.push(next);
      cur = next;
    }
    return chain;
  };
  // сначала открытые концы (степень 1), потом замкнутые петли
  const order = [...adj.keys()].sort((a, b) => adj.get(a)!.length - adj.get(b)!.length);
  for (const e of order) {
    while ((adj.get(e) ?? []).some((n) => !used.has(key(e, n)))) {
      const chain = walk(e);
      if (chain.length < 2) break;
      if (chain.length < 4 && chain[0] !== chain[chain.length - 1]) continue; // мусор
      out.push('M' + chain.map(fmt).join('L'));
    }
  }
  return out;
}
