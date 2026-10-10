// GLSL-шейдеры пайплайна (SPEC §3). Проходы:
//  warp     — 1. Ч/Б и тон + 2. жидкое искажение   → rgb исходника, a = тон
//  halftone — 3. порог + 4. растр                   → r высота, g тон, b белая зона, a краска
//  blur×2   — 5. размытие поля высот и тона
//  shade    — 5. нормали, 6. свет и хром, 7. контуры, 8. цвет и инверсия

export const VERT = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const NOISE = /* glsl */ `
// Simplex 3D noise — Ashima Arts / Stefan Gustavson (MIT)
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

/** Поле смещения (domain warping) — гладкое, считается в низком разрешении */
export const FIELD = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uAspect;   // ширина / высота
uniform float uFreq;     // периодов шума на высоту кадра
uniform float uTime;
uniform vec3 uSeed;
uniform vec4 uCrop;      // фрагмент кадра в uv: xy — начало, zw — размер (весь кадр — 0,0,1,1)
${NOISE}
float fbm(vec3 p) {
  // две октавы — гладкое поле
  return snoise(p) * 0.66 + snoise(p * 2.03 + vec3(17.1, 3.3, 7.7)) * 0.34;
}
void main() {
  vec2 uv = uCrop.xy + vUv * uCrop.zw;
  vec3 p = vec3(uv.x * uAspect, uv.y, 0.0) * vec3(uFreq, uFreq, 1.0) + vec3(0.0, 0.0, uTime) + uSeed;
  // warp от warp
  vec2 q = vec2(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)));
  vec3 p2 = p + vec3(q * 1.6, 0.0);
  vec2 r = vec2(fbm(p2 + vec3(1.7, 9.2, 0.0)), fbm(p2 + vec3(8.3, 2.8, 0.0)));
  o = vec4(clamp(r * 0.25 + 0.5, 0.0, 1.0), 0.0, 1.0);
}`;

export const WARP = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform sampler2D uField;
uniform float uAspect;
uniform float uAmp;      // амплитуда смещения, доли высоты кадра
uniform vec4 uCrop;
uniform float uContrast;
uniform float uGamma;
vec2 mirror(vec2 x) { return 1.0 - abs(mod(x, 2.0) - 1.0); }
void main() {
  vec2 offset = (texture(uField, vUv).rg - 0.5) * 4.0 * uAmp;
  offset.x /= uAspect;
  vec4 c = texture(uSrc, mirror(uCrop.xy + vUv * uCrop.zw + offset));
  vec3 rgb = mix(vec3(1.0), c.rgb, c.a); // прозрачное — белое
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  l = clamp((l - 0.5) * uContrast + 0.5, 0.0, 1.0);
  l = pow(l, uGamma);
  o = vec4(rgb, l);
}`;

export const HALFTONE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTone;
uniform vec2 uRes;       // размер цели, px
uniform float uCell;     // шаг сетки, px цели
uniform float uAngle;    // радианы
uniform float uThr;      // порог 0…1
uniform float uSoft;     // мягкость порога
uniform float uRmax;     // макс. радиус точки, доли шага
uniform float uMerge;    // сила слияния, доли шага
uniform float uLod;

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float darkness(float l) {
  // выше порога — чистый белый; ниже — тон, растянутый на весь диапазон
  float t = clamp(l / max(uThr, 1e-3), 0.0, 1.0);
  float edge = 1.0 - smoothstep(uThr - uSoft, uThr, l);
  return (1.0 - t) * edge;
}

void main() {
  vec2 px = vUv * uRes;
  float ca = cos(uAngle), sa = sin(uAngle);
  mat2 rot = mat2(ca, sa, -sa, ca);
  vec2 q = (transpose(rot) * px) / uCell;
  vec2 base = floor(q);
  float sd = 1e3;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = base + vec2(float(i), float(j)) + 0.5;
      vec2 cuv = (rot * (c * uCell)) / uRes;
      float dk = darkness(textureLod(uTone, clamp(cuv, 0.0, 1.0), uLod).a);
      if (dk > 0.002) {
        float r = uRmax * pow(dk, 0.6);
        sd = smin(sd, length(q - c) - r, uMerge);
      }
    }
  }
  float l = texture(uTone, vUv).a;
  float dkPix = darkness(l);
  // в самых тёмных зонах точки сливаются в гладкую заливку
  float solid = smoothstep(0.8, 0.94, dkPix);
  float aa = 0.7 / uCell;                               // ~1 px в долях шага
  float ink = max(1.0 - smoothstep(-aa, aa, sd), solid); // покрытие краской
  float dome = clamp(-sd / 0.42, 0.0, 1.0);             // купол каждой точки
  dome = sqrt(dome * (2.0 - dome));
  float h = max(dome * (1.0 - smoothstep(-aa, aa, sd)), solid);
  o = vec4(h, l, l, ink);
}`;

export const BLUR = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;  // растр: r высота, g тон, b тон, a краска
uniform sampler2D uLum;  // для тона контуров: 1-й проход — тон с mip-уровнями (a), 2-й — результат 1-го прохода (g)
uniform int uLumCh;      // 3 — канал a, 1 — канал g
uniform float uLumLod;
uniform vec2 uDir;       // (1/w, 0) или (0, 1/h)
uniform float uSigA;     // для r, b, a (высота, тон для хрома, краска), px
uniform float uSigB;     // для g (тон для контуров), px
const int TAPS_A = 6;
const int TAPS_B = 4;
float lum(vec2 uv) {
  vec4 v = textureLod(uLum, uv, uLumLod);
  return uLumCh == 3 ? v.a : v.g;
}
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 accA = c.rba;
  float wA = 1.0;
  if (uSigA > 0.3) {
    float stepA = uSigA * 2.5 / float(TAPS_A);
    for (int i = 1; i <= TAPS_A; i++) {
      float x = float(i) * stepA;
      float w = exp(-x * x / (2.0 * uSigA * uSigA));
      accA += (texture(uTex, vUv + uDir * x).rba + texture(uTex, vUv - uDir * x).rba) * w;
      wA += 2.0 * w;
    }
  }
  float accB = lum(vUv);
  float wB = 1.0;
  float stepB = uSigB * 2.5 / float(TAPS_B);
  for (int i = 1; i <= TAPS_B; i++) {
    float x = float(i) * stepB;
    float w = exp(-x * x / (2.0 * uSigB * uSigB));
    accB += (lum(vUv + uDir * x) + lum(vUv - uDir * x)) * w;
    wB += 2.0 * w;
  }
  accA /= wA;
  o = vec4(accA.x, accB / wB, accA.y, accA.z);
}`;

export const SHADE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uHT;    // резкий растр: r высота, g тон, b тон, a краска
uniform sampler2D uBL;    // размытый: r высота, g тон (контуры), b тон (хром), a краска
uniform sampler2D uTone;  // rgb исходника после искажения
uniform vec2 uRes;
uniform float uCell;
uniform float uVolume;
uniform float uGloss;
uniform vec3 uLight;
uniform float uThr;
uniform float uSoft;
uniform float uContours;
uniform float uContourN;
uniform float uContourW;  // px цели
uniform int uColorMode;   // 0 ч/б, 1 тон, 2 исходные
uniform int uToneMode;    // 0 сплошной, 1 градиент
uniform vec3 uSolid;
uniform vec3 uShadow;
uniform vec3 uLightCol;
uniform float uIntensity;
uniform float uInvert;

const float PAPER = 0.9;
const float INK = 0.17;
const float CHROME = 0.8;

void main() {
  vec2 tx = 1.0 / uRes;
  vec4 s = texture(uHT, vUv);
  vec4 b = texture(uBL, vUv);
  vec4 bl = texture(uBL, vUv - vec2(tx.x, 0.0));
  vec4 br = texture(uBL, vUv + vec2(tx.x, 0.0));
  vec4 bd = texture(uBL, vUv - vec2(0.0, tx.y));
  vec4 bu = texture(uBL, vUv + vec2(0.0, tx.y));
  float thr = max(uThr, 1e-3);

  // 5. Рельеф: нормали из размытого поля высот
  float hpx = uVolume * uCell * 0.55;
  vec3 n = normalize(vec3((bl.r - br.r) * 0.5 * hpx, (bd.r - bu.r) * 0.5 * hpx, 1.0));

  // 6. Свет: Ламберт + Blinn-Phong
  float ink = mix(s.a, b.a, 0.3 * uVolume);
  float albedo = mix(PAPER, INK, ink);
  float ndl = max(dot(n, uLight), 0.0) / uLight.z;
  float diffuse = mix(1.0, ndl, 0.9);
  vec3 H = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float shin = mix(10.0, 48.0, uGloss);
  float spec = max(pow(max(dot(n, H), 0.0), shin) - pow(H.z, shin), 0.0);
  spec *= uGloss * 1.6;
  float g = albedo * diffuse + spec * mix(0.55, 1.0, ink);

  // Хром в светлых гладких зонах: гладкий металл, резкий блик и тёмная окантовка
  float white = smoothstep(thr - uSoft, thr, s.g);
  float lc = b.b;
  vec2 gl = vec2(br.b - bl.b, bu.b - bd.b) * 0.5;   // градиент тона, на px
  float slope = length(gl) * uCell;                  // перепад тона на шаг сетки
  float zone = smoothstep(0.62, 0.76, lc / thr);
  vec3 nm = normalize(vec3(-gl * uCell * 3.0, 1.0));
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), nm);
  float hl = smoothstep(0.9, 0.95, dot(r, uLight)) * (1.0 - white);
  float shadeM = mix(1.0, max(dot(nm, uLight), 0.0) / uLight.z, 0.85);
  float rim = zone * (1.0 - zone) * 4.0 * smoothstep(0.04, 0.16, slope);
  float chrome = CHROME * shadeM + hl * 0.6;
  float cz = zone * uGloss;
  g = mix(g, chrome, cz * (1.0 - white));
  g *= 1.0 - 0.85 * rim * uGloss;
  float hiMask = clamp(spec + hl * cz, 0.0, 1.0);

  // Чистый белый выше порога
  g = mix(g, 1.0, white);

  // 7. Контуры: изолинии размытого тона, строго внутри диапазона ниже порога
  if (uContours > 0.5) {
    float v = b.g / thr * (uContourN + 1.0);
    float fw = max(fwidth(v), 1e-5);
    float d = abs(fract(v + 0.5) - 0.5) / fw;
    float line = 1.0 - smoothstep(uContourW * 0.5 - 0.5, uContourW * 0.5 + 0.5, d);
    line *= step(0.5, v) * (1.0 - step(uContourN + 0.5, v));
    g = mix(g, g * 0.2, line * 0.75);
  }

  g = clamp(g, 0.0, 1.0);

  // 8. Цвет и инверсия
  vec3 col = vec3(g);
  if (uColorMode == 1) {
    vec3 t = uToneMode == 0 ? col * uSolid : mix(uShadow, uLightCol, g);
    col = mix(col, t, uIntensity);
  } else if (uColorMode == 2) {
    vec3 orig = texture(uTone, vUv).rgb;
    float lo = dot(orig, vec3(0.2126, 0.7152, 0.0722));
    vec3 chroma = (orig - lo) * 1.25 * uIntensity * (1.0 - hiMask);
    col = clamp(col + chroma * (0.35 + 0.65 * g), 0.0, 1.0);
  }
  if (uInvert > 0.5) col = 1.0 - col;
  o = vec4(col, 1.0);
}`;

export const COPY = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
void main() { o = texture(uTex, vUv); }`;
