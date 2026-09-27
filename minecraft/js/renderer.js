/* Кубокрафт — WebGL-рендерер: блоки, вода, небо, облака, мобы и предметы,
   частицы, трещины добычи, рамка выделения, предмет в руке.
   Свет считается в шейдере: солнце или луна по нормали грани, небесный эмбиент,
   свет факелов из мешера и до 8 динамических источников (факел в руке, вспышки,
   фары). По настройкам качества добавляются тени от светила (карта глубины) и
   постобработка: HDR-буфер, свечение (bloom), мягкий тонмаппинг, цветокоррекция.
   Работает на WebGL2 и WebGL1 (шейдеры GLSL ES 1.0). */
(function (KC) {
  'use strict';

  var FLOATS = KC.FLOATS, STRIDE = FLOATS * 4;
  var MAX_QUADS = 16384;
  var HP = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  var TILE_DEFS = '#define TILES_X ' + (KC.ATLAS_W / 16).toFixed(1) + '\n#define TILES_Y ' + (KC.ATLAS_H / 16).toFixed(1) + '\n';


  // ---- Общие куски шейдеров -----------------------------------------------------------
  var IS_DEF = '#define IS(a, k) (abs((a) - (k)) < 0.5)\n';

  var DYN_GLSL = [
    'uniform vec4 uLP[NL]; uniform vec4 uLC[NL]; uniform vec4 uLD[NL]; uniform float uNumL;',
    // точечные и направленные (фары) источники: позиция+радиус, цвет+косинус конуса, направление
    'vec3 dynLight(vec3 P, vec3 N, float omni) {',
    '  vec3 acc = vec3(0.0);',
    '  for (int i = 0; i < NL; i++) {',
    '    if (float(i) >= uNumL) break;',
    '    vec4 lp = uLP[i];',
    '    vec3 d = lp.xyz - P;',
    '    float d2 = dot(d, d);',
    '    float r2 = lp.w * lp.w;',
    '    if (d2 < r2) {',
    '      vec3 l = d * inversesqrt(max(d2, 1e-4));',
    '      float att = 1.0 - d2 / r2;',
    '      att *= att;',
    '      float ndl = mix(max(dot(N, l), 0.0), 0.8, omni);',
    '      vec4 lc = uLC[i];',
    '      float spot = lc.w > -1.5 ? smoothstep(lc.w, lc.w + 0.1, dot(-l, uLD[i].xyz)) : 1.0;',
    '      acc += lc.rgb * (att * ndl * spot);',
    '    }',
    '  }',
    '  return acc;',
    '}'
  ].join('\n');

  var SHADOW_GLSL = [
    '#ifdef SHADOWS',
    'uniform sampler2D uShadow; uniform mat4 uLVP; uniform vec4 uShP;',
    // четыре выборки с билинейными весами — мягкий край тени без аппаратного сравнения
    'float shTap(vec2 base, vec2 f, float d) {',
    '  float t = uShP.x;',
    '  float a = step(d, texture2D(uShadow, base).r);',
    '  float b = step(d, texture2D(uShadow, base + vec2(t, 0.0)).r);',
    '  float c = step(d, texture2D(uShadow, base + vec2(0.0, t)).r);',
    '  float e = step(d, texture2D(uShadow, base + vec2(t, t)).r);',
    '  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);',
    '}',
    'float shadowAt(vec3 P, vec3 N, float omni, float fallback) {',
    '  vec3 Q = P + N * (uShP.z * (1.0 - omni)) + uSunDir * (0.02 + omni * 0.14);',
    '  vec4 lp = uLVP * vec4(Q, 1.0);',
    '  vec3 s = lp.xyz * 0.5 + 0.5;',
    '  float edge = max(abs(s.x - 0.5), abs(s.y - 0.5)) * 2.0;',
    '  if (edge > 1.0 || s.z > 1.0) return fallback;',
    '  float d = s.z - uShP.y;',
    '  vec2 tc = s.xy / uShP.x - 0.5;',
    '  vec2 f = fract(tc);',
    '  vec2 base = (floor(tc) + 0.5) * uShP.x;',
    '#if SHADOWS > 1',
    '  float t = uShP.x;',
    '  float v = (shTap(base - vec2(t, t), f, d) + shTap(base + vec2(t, -t), f, d) + shTap(base + vec2(-t, t), f, d) + shTap(base + vec2(t, t), f, d)) * 0.25;',
    '#else',
    '  float v = shTap(base, f, d);',
    '#endif',
    '  return mix(v, fallback, smoothstep(0.82, 1.0, edge));',
    '}',
    '#else',
    'float shadowAt(vec3 P, vec3 N, float omni, float fallback) { return fallback; }',
    '#endif',
    // тени облаков: точка проецируется вдоль луча солнца на слой облаков
    '#ifdef CLOUDSH',
    'uniform sampler2D uCloudTex; uniform vec4 uCloudP;',
    'float cloudShadow(vec3 P) {',
    '  float t = (uCloudP.x - P.y) / max(uSunDir.y, 0.2);',
    '  vec2 q = P.xz + uSunDir.xz * t;',
    '  return 1.0 - texture2D(uCloudTex, (q + vec2(uCloudP.y, 0.0)) / uCloudP.z).a * uCloudP.w;',
    '}',
    '#else',
    'float cloudShadow(vec3 P) { return 1.0; }',
    '#endif'
  ].join('\n');

  // ---- Блоки ------------------------------------------------------------------------------
  // aLight.x упакован: материал × 2048 + нормаль (0…5 — грань, 6 — «со всех сторон») × 256 + AO × 200.
  // Грани кубов плоские, поэтому рассеянный свет, солнце по нормали, оттенок травы и туман считаются
  // в вершинах; в пикселе остаются тень, динамические огни и особые материалы (вода, свечение, блики).
  var BLOCK_VS = [
    'attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aLight;',
    'uniform mat4 uVP; uniform float uTimeV; uniform float uWind; uniform vec3 uCamV;',
    'uniform vec3 uSunDirV; uniform vec3 uSunColV; uniform vec3 uAmbTop; uniform vec3 uAmbBot; uniform vec3 uAmbCave;',
    'uniform vec3 uBlockCol; uniform float uSkyDep; uniform float uBright;',
    'uniform vec3 uFog; uniform vec3 uFogSun; uniform vec2 uFogR;',
    'varying vec2 vUV; varying vec2 vL; varying vec3 vBase; varying vec3 vSun;',
    '#ifdef FANCY',
    'varying vec3 vN; varying vec3 vW; varying vec4 vFog;',
    '#else',
    'varying float vFogK;',
    '#endif',
    IS_DEF,
    'void main() {',
    '  float pk = aLight.x;',
    '  float mat = floor(pk / 2048.0);',
    '  float rest = pk - mat * 2048.0;',
    '  float ni = floor(rest / 256.0);',
    '  float ao = (rest - ni * 256.0) / 200.0;',
    '  vec3 N = vec3(0.0);',
    '  if (ni < 5.5) {',
    '    float ax = floor(ni * 0.5);',
    '    float sg = 1.0 - 2.0 * (ni - ax * 2.0);',
    '    N = vec3(IS(ax, 0.0) ? sg : 0.0, IS(ax, 1.0) ? sg : 0.0, IS(ax, 2.0) ? sg : 0.0);',
    '  }',
    '  float omni = ni > 5.5 ? 1.0 : 0.0;',
    '  vec3 P = aPos;',
    '#ifdef SWAY',
    // трава, цветы и посевы качают верхушками, листва — целиком и слабее, огонь — быстро
    '  if (IS(mat, 1.0) || IS(mat, 2.0) || IS(mat, 7.0) || IS(mat, 10.0)) {',
    '    float top = IS(mat, 2.0) ? 0.28 : step(fract(aUV.y * TILES_Y), 0.5);',
    '    float ph = uTimeV * (IS(mat, 7.0) ? 6.0 : 1.7) + P.x * 0.73 + P.z * 0.51;',
    '    float amp = (IS(mat, 7.0) ? 0.05 : 0.075) * uWind * top;',
    '    P.x += (sin(ph) + 0.35 * sin(ph * 2.7 + P.z)) * amp;',
    '    P.z += cos(ph * 0.83 + 1.7) * amp;',
    '  }',
    // поверхность воды и лавы волнуется; вершины на целых высотах (дно, стыки) стоят
    '  float fy = fract(P.y);',
    '  if ((IS(mat, 3.0) || IS(mat, 4.0)) && fy > 0.02 && fy < 0.98) {',
    '    float sp = IS(mat, 4.0) ? 0.3 : 1.0;',
    '    P.y += (sin(uTimeV * 1.6 * sp + P.x * 0.9 + P.z * 0.4) + sin(uTimeV * 2.3 * sp - P.z * 1.1 + P.x * 0.3)) * 0.022 - 0.045;',
    '  }',
    '#endif',
    '  gl_Position = uVP * vec4(P, 1.0);',
    '  float sky = aLight.y;',
    '  float skyK = mix(1.0, sky * sky, uSkyDep);',
    '  float ny = omni > 0.5 ? 0.35 : N.y;',
    '  vec3 base = mix(uAmbBot, uAmbTop, ny * 0.5 + 0.5) * (1.0 - 0.07 * abs(N.x)) * skyK + uAmbCave;',
    // факелы днём добавляют меньше: иначе у окна светло как у прожектора
    '  base += uBlockCol * aLight.z * (1.0 - 0.55 * clamp(dot(base, vec3(0.3, 0.5, 0.2)), 0.0, 1.0));',
    '  base = mix(base, sqrt(base), uBright);',
    '  float ndl = omni > 0.5 ? 0.62 : max(dot(N, uSunDirV), 0.0);',
    '  vec3 tint = vec3(1.0);',
    // трава и листва чуть меняют оттенок по местности — меньше повторов
    '  if ((IS(mat, 9.0) && N.y > 0.5) || IS(mat, 2.0) || IS(mat, 1.0)) {',
    '    float g = 0.5 + 0.3 * sin(P.x * 0.047 + sin(P.z * 0.031) * 2.3) + 0.2 * sin(P.z * 0.053 - P.x * 0.021);',
    '    tint = mix(vec3(1.04, 1.02, 0.86), vec3(0.9, 1.0, 1.0), g);',
    '  }',
    '  vBase = base * ao * tint;',
    '  vSun = uSunColV * ndl * ao * tint;',
    '  float fk = clamp((length(P.xz - uCamV.xz) - uFogR.x) / (uFogR.y - uFogR.x), 0.0, 1.0);',
    '#ifdef FANCY',
    '  vec3 vd = normalize(P - uCamV + vec3(0.0, 1e-3, 0.0));',
    '  vFog = vec4(mix(uFog, uFogSun, pow(max(dot(vd, uSunDirV), 0.0), 6.0)), fk);',
    '  vN = omni > 0.5 ? vec3(0.0) : N; vW = P;',
    '#else',
    '  vFogK = fk;',
    '#endif',
    '  vUV = aUV; vL = vec2(sky, mat);',
    '}'
  ].join('\n');

  var BLOCK_FS = [
    'uniform sampler2D uTex; uniform vec3 uCam; uniform float uAlpha; uniform float uCut; uniform float uTime; uniform float uEmit;',
    'uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uFogC; uniform float uWet;',
    DYN_GLSL, SHADOW_GLSL,
    'varying vec2 vUV; varying vec2 vL; varying vec3 vBase; varying vec3 vSun;',
    '#ifdef FANCY',
    'varying vec3 vN; varying vec3 vW; varying vec4 vFog;',
    '#else',
    'varying float vFogK;',
    '#endif',
    IS_DEF,
    // сдвиг внутри плитки атласа: течение лавы и воды, вихрь портала
    'vec2 tileAnim(vec2 uv, vec2 off) {',
    '  vec2 ts = vec2(1.0 / TILES_X, 1.0 / TILES_Y);',
    '  vec2 o = floor(uv / ts) * ts;',
    '  vec2 l = fract((uv - o) / ts + off);',
    '  return o + clamp(l, 0.004, 0.996) * ts;',
    '}',
    '#ifdef WATERFX',
    'uniform sampler2D uRefr; uniform sampler2D uRefrD; uniform vec2 uScreen; uniform vec2 uNF; uniform mat4 uVPF;',
    'float linZW(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }',
    '#endif',
    '#ifdef FANCY',
    'float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vnoise(vec2 p) {',
    '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    '#endif',
    'void main() {',
    '  float mat = vL.y;',
    '  vec2 uv = vUV;',
    '  if (mat > 2.5 && mat < 6.5) {',
    '    if (IS(mat, 4.0)) uv = tileAnim(uv, vec2(sin(uTime * 0.25 + uv.x * 40.0) * 0.06, uTime * 0.035));',
    '    else if (IS(mat, 3.0)) uv = tileAnim(uv, vec2(uTime * 0.025, uTime * 0.014));',
    '    else if (IS(mat, 6.0)) {',
    '      vec2 ts = vec2(1.0 / TILES_X, 1.0 / TILES_Y);',
    '      vec2 o = floor(uv / ts) * ts; vec2 l = (uv - o) / ts - 0.5;',
    '      float a = uTime * 0.7 + length(l) * 5.0; float cs = cos(a), sn = sin(a);',
    '      uv = tileAnim(o + (vec2(l.x * cs - l.y * sn, l.x * sn + l.y * cs) * 0.9 + 0.5) * ts, vec2(0.0));',
    '    }',
    '  }',
    '  vec4 c = texture2D(uTex, uv);',
    '  if (c.a < uCut) discard;',
    '  float alpha = c.a * uAlpha;',
    '#ifdef FANCY',
    '  float omni = dot(vN, vN) < 0.5 ? 1.0 : 0.0;',
    '  vec3 N = omni > 0.5 ? vec3(0.0, 1.0, 0.0) : vN;',
    '  float sh = 0.0;',
    '  if (vSun.r + vSun.g + vSun.b > 0.002) sh = shadowAt(vW, N, omni, smoothstep(0.82, 1.0, vL.x)) * cloudShadow(vW);',
    '  vec3 L = vBase + vSun * sh;',
    '  if (uNumL > 0.5) L += dynLight(vW, N, omni);',
    '  vec3 col = c.rgb * L;',
    // мокрые поверхности под дождём темнеют и отражают небо
    '  if (uWet > 0.01 && N.y > 0.5 && omni < 0.5 && !IS(mat, 3.0)) {',
    '    float w = uWet * smoothstep(0.85, 1.0, vL.x);',
    '    vec3 V = normalize(uCam - vW);',
    '    vec3 R = reflect(-V, N);',
    '    col = col * (1.0 - 0.3 * w) + mix(uSkyHor, uSkyTop, clamp(R.y, 0.0, 1.0)) * (0.16 * w * pow(1.0 - max(dot(N, V), 0.0), 3.0));',
    '    col += uSunCol * pow(max(dot(R, uSunDir), 0.0), 90.0) * 2.5 * w * sh;',
    '  }',
    '  if (mat > 3.5) {',
    // металл и стекло ловят блики солнца
    '    if (IS(mat, 11.0) || IS(mat, 8.0)) {',
    '      vec3 V = normalize(uCam - vW);',
    '      vec3 H = normalize(V + uSunDir);',
    '      col += uSunCol * pow(max(dot(N, H), 0.0), 60.0) * sh * (IS(mat, 8.0) ? 1.4 : 0.8);',
    '    }',
    // светящиеся блоки не зависят от освещения и дают яркость выше 1 для свечения
    '    else if (IS(mat, 5.0) || IS(mat, 4.0) || IS(mat, 6.0) || IS(mat, 7.0) || IS(mat, 10.0) || IS(mat, 12.0)) {',
    '      float fl = IS(mat, 7.0) ? 1.0 + 0.22 * sin(uTime * 13.0 + vW.x * 3.1 + vW.z * 1.7) + 0.12 * sin(uTime * 23.0 + vW.y * 5.0) : 1.0;',
    '      if (IS(mat, 4.0)) fl = 0.92 + 0.12 * sin(uTime * 1.3 + vW.x * 0.7 - vW.z * 0.5);',
    // мигающий жёлтый светофора в брошенном городе
    '      if (IS(mat, 12.0)) fl = 0.08 + step(0.5, fract(uTime * 0.8 + (vW.x + vW.z) * 0.013)) * 1.1;',
    '      col = mix(col, c.rgb * uEmit * fl, IS(mat, 10.0) ? 0.6 : 1.0);',
    '    }',
    '  } else if (IS(mat, 3.0) && N.y > 0.5) {',
    // вода: рябь, отражение неба по Френелю и солнечная дорожка
    '    vec2 p = vW.xz; float t = uTime;',
    '    float dx = cos(p.x * 1.3 + t * 1.7) * 0.05 + cos(p.x * 0.7 - p.y * 1.1 + t * 1.1) * 0.05 + (vnoise(p * 1.7 + t * 0.6) - 0.5) * 0.12;',
    '    float dz = cos(p.y * 1.1 + t * 1.3) * 0.05 + sin(p.x * 0.9 + p.y * 0.8 - t * 0.9) * 0.05 + (vnoise(p * 1.7 - t * 0.5 + 13.0) - 0.5) * 0.12;',
    '    vec3 wn = normalize(vec3(-dx, 1.0, -dz));',
    '    vec3 V = normalize(uCam - vW);',
    '    float above = step(vW.y, uCam.y);',
    '    float fres = mix(0.2, 0.03 + 0.97 * pow(1.0 - max(dot(wn, V), 0.0), 5.0), above);',
    '    vec3 R = reflect(-V, wn);',
    '    vec3 skyc = mix(uSkyHor, uSkyTop, clamp(R.y, 0.0, 1.0)) * (0.3 + 0.7 * vL.x * vL.x);',
    '    vec3 spec = uSunCol * pow(max(dot(R, uSunDir), 0.0), 220.0) * 7.0 * sh * above;',
    '#ifdef WATERFX',
    '    if (above > 0.5) {',
    // преломление: картинка под водой с искажением от ряби; толща воды поглощает сначала красный
    '      vec2 suv = gl_FragCoord.xy * uScreen;',
    '      float zW = 1.0 / gl_FragCoord.w;',
    '      vec2 ruv = suv + wn.xz * (0.06 / (1.0 + zW * 0.08));',
    '      float zS = linZW(texture2D(uRefrD, ruv).r);',
    '      if (zS < zW - 0.05) { ruv = suv; zS = linZW(texture2D(uRefrD, suv).r); }',
    '      float thick = clamp(zS - zW, 0.0, 60.0);',
    '      vec3 absorb = exp(-thick * vec3(0.55, 0.19, 0.13));',
    // толща воды — ровный сине-зелёный цвет, освещённый сверху (без узора текстуры)
    '      vec3 deep = vec3(0.05, 0.19, 0.25) * (vBase + vSun * sh) * 1.5;',
    '      vec3 under = texture2D(uRefr, ruv).rgb * absorb + deep * (1.0 - absorb);',
    // отражение: шагаем по отражённому лучу и ищем, где он уходит за поверхность в буфере глубины
    '      vec3 refl = skyc;',
    '      vec3 rp = vW; float sl = 0.3, hit = 0.0; vec2 huv = vec2(0.0);',
    '      for (int i = 0; i < SSR_STEPS; i++) {',
    '        rp += R * sl; sl *= 1.25;',
    '        vec4 cp = uVPF * vec4(rp, 1.0);',
    '        if (cp.w < 0.1) break;',
    '        vec2 u2 = cp.xy / cp.w * 0.5 + 0.5;',
    '        if (u2.x < 0.0 || u2.x > 1.0 || u2.y < 0.0 || u2.y > 1.0) break;',
    '        float dd = cp.w - linZW(texture2D(uRefrD, u2).r);',
    '        if (dd > 0.02 && dd < sl * 1.6 + 0.4) { hit = 1.0; huv = u2; break; }',
    '      }',
    '      if (hit > 0.5) {',
    '        vec2 eg = min(huv, 1.0 - huv);',
    '        refl = mix(refl, texture2D(uRefr, huv).rgb, smoothstep(0.0, 0.08, min(eg.x, eg.y)));',
    '      }',
    '      col = mix(under, refl, clamp(fres, 0.0, 1.0)) + spec;',
    '      alpha = 1.0;',
    '    } else {',
    '      col = mix(col, skyc, clamp(fres * 0.85, 0.0, 1.0)) + spec;',
    '      alpha = mix(0.62, 0.93, fres) * step(uCut, c.a);',
    '    }',
    '#else',
    '    col = mix(col, skyc, clamp(fres * 0.85, 0.0, 1.0)) + spec;',
    '    alpha = mix(0.62, 0.93, fres) * step(uCut, c.a);',
    '#endif',
    '  }',
    '  gl_FragColor = vec4(mix(col, vFog.rgb, vFog.a), alpha);',
    '#else',
    // простой путь: тень — по открытости неба, без бликов и отражений
    '  vec3 col = c.rgb * (vBase + vSun * smoothstep(0.82, 1.0, vL.x));',
    '  if ((mat > 3.5 && mat < 7.5) || IS(mat, 10.0)) col = mix(col, c.rgb * uEmit, IS(mat, 10.0) ? 0.6 : 1.0);',
    '  if (IS(mat, 12.0)) col = c.rgb * uEmit * (0.08 + step(0.5, fract(uTime * 0.8 + vUV.x * 3.0)));',
    '  gl_FragColor = vec4(mix(col, uFogC, vFogK), alpha);',
    '#endif',
    '}'
  ].join('\n');

  // ---- Сущности, частицы, предмет в руке: цвет вершины уже содержит свет и оттенок ----------------
  var ENT_VS = [
    'attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aCol;',
    'uniform mat4 uVP; uniform vec3 uCam; uniform vec3 uFog; uniform vec3 uFogSun; uniform vec2 uFogR; uniform vec3 uSunDir;',
    'varying vec2 vUV; varying vec3 vCol; varying vec3 vW; varying vec4 vFog;',
    'void main() {',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '  vUV = aUV; vCol = aCol; vW = aPos;',
    '  vec3 vd = normalize(aPos - uCam + vec3(0.0, 1e-3, 0.0));',
    '  vFog = vec4(mix(uFog, uFogSun, pow(max(dot(vd, uSunDir), 0.0), 6.0)), clamp((length(aPos.xz - uCam.xz) - uFogR.x) / (uFogR.y - uFogR.x), 0.0, 1.0));',
    '}'
  ].join('\n');

  var ENT_FS = [
    'uniform sampler2D uTex; uniform float uAlpha; uniform float uCut; uniform float uDyn;',
    DYN_GLSL,
    'varying vec2 vUV; varying vec3 vCol; varying vec3 vW; varying vec4 vFog;',
    'void main() {',
    '  vec4 c = texture2D(uTex, vUV);',
    '  if (c.a < uCut) discard;',
    '  vec3 L = vCol;',
    '  if (uDyn > 0.5 && uNumL > 0.5) L += dynLight(vW, vec3(0.0, 1.0, 0.0), 1.0);',
    '  gl_FragColor = vec4(mix(c.rgb * L, vFog.rgb, vFog.a), c.a * uAlpha);',
    '}'
  ].join('\n');

  // ---- Карта теней: глубина из позиции светила, вырезая прозрачные пиксели листвы -----------
  var SHADOW_VS = [
    'attribute vec3 aPos; attribute vec2 aUV;',
    'uniform mat4 uLVP;',
    'varying vec2 vUV;',
    'void main() { vUV = aUV; gl_Position = uLVP * vec4(aPos, 1.0); }'
  ].join('\n');
  var SHADOW_FS = [
    'uniform sampler2D uTex;',
    'varying vec2 vUV;',
    'void main() { if (texture2D(uTex, vUV).a < 0.5) discard; gl_FragColor = vec4(1.0); }'
  ].join('\n');

  // ---- Небо ------------------------------------------------------------------------------------
  var SKY_VS = 'attribute vec2 aPos; varying vec2 vP; void main() { vP = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }';
  var SKY_FS = [
    'uniform vec3 uFwd; uniform vec3 uRight; uniform vec3 uUp; uniform vec2 uScale;',
    'uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunR; uniform vec3 uSunU;',
    'uniform vec3 uGlow; uniform float uNight; uniform float uSunVis; uniform float uPlanet; uniform float uSunK;',
    'uniform float uTime; uniform float uMoon;',
    'varying vec2 vP;',
    'float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }',
    'float noise3(vec3 p) {',
    '  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  float a = mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);',
    '  float b = mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);',
    '  return mix(a, b, f.z);',
    '}',
    'void main() {',
    '  vec3 d = normalize(uFwd + vP.x * uScale.x * uRight + vP.y * uScale.y * uUp);',
    '  float t = clamp(d.y, 0.0, 1.0);',
    '  vec3 col = mix(uHor, uTop, pow(t, 0.5));',
    '  if (d.y < 0.0) col = mix(uHor, uHor * 0.78, clamp(-d.y * 3.0, 0.0, 1.0));',
    '  float sd = dot(d, uSun);',
    // ореол вокруг солнца и тёплая полоса у горизонта на закате
    '  col += uGlow * (pow(max(sd, 0.0), 8.0) * (1.0 - t * 0.7) + pow(max(sd, 0.0), 90.0) * 0.8);',
    '  col += uGlow * 0.35 * (1.0 - t) * (1.0 - t) * (0.5 + 0.5 * sd);',
    '  if (uNight > 0.01 && (d.y > 0.0 || uPlanet > 0.5)) {',
    // звёзды разной яркости и цвета, мерцают
    '    vec3 cell = floor(d * 240.0);',
    '    float h = hash(cell);',
    '    if (h > 0.9966) {',
    '      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + fract(h * 97.0) * 4.0) + h * 300.0);',
    '      vec3 sc = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.88, 0.72), hash(cell + 7.0));',
    '      col += sc * uNight * (h - 0.9966) * 330.0 * tw * max(min(t * 3.0, 1.0), uPlanet);',
    '    }',
    // Млечный Путь — светлая неровная полоса через всё небо
    '    vec3 mwN = normalize(vec3(0.35, 0.3, 0.89));',
    '    float band = exp(-pow(dot(d, mwN) * 4.2, 2.0));',
    '    float n = noise3(d * 7.0) * 0.6 + noise3(d * 19.0) * 0.4;',
    '    col += vec3(0.5, 0.56, 0.8) * band * smoothstep(0.35, 0.9, n) * 0.09 * uNight * max(min(t * 2.5, 1.0), uPlanet);',
    '  }',
    '  if (uPlanet > 0.5) {',
    // планета: освещённый солнцем шар с океанами, материками и облаками
    '    vec3 pc = normalize(vec3(0.55, -0.3, -0.78));',
    '    vec3 pr = normalize(cross(pc, vec3(0.0, 1.0, 0.0))); vec3 pu = cross(pr, pc);',
    '    float pd = dot(d, pc);',
    '    if (pd > 0.85) {',
    '      vec2 q = vec2(dot(d, pr), dot(d, pu)) / 0.46;',
    '      float r2 = dot(q, q);',
    '      if (r2 < 1.0) {',
    '        vec3 n = normalize(q.x * pr + q.y * pu - sqrt(1.0 - r2) * pc);',
    '        vec2 g = floor(q * 16.0);',
    '        float land = step(0.58, hash(vec3(floor(g / 3.0), 1.0)) * 0.7 + hash(vec3(g, 2.0)) * 0.3);',
    '        vec3 base = mix(vec3(0.1, 0.28, 0.62), vec3(0.22, 0.46, 0.2), land);',
    '        float cl = step(0.78, hash(vec3(floor(q * 26.0 + vec2(uSun.x * 3.0, 0.0)), 3.0)));',
    '        base = mix(base, vec3(0.94, 0.95, 0.97), cl * 0.85);',
    '        float lit = clamp(dot(n, uSun) * 1.1 + 0.06, 0.03, 1.0);',
    // огни городов на ночной стороне
    '        float city = step(0.93, hash(vec3(floor(q * 40.0), 5.0))) * land * (1.0 - smoothstep(0.0, 0.25, lit));',
    '        col = base * lit + vec3(1.0, 0.8, 0.45) * city * 0.6 + vec3(0.25, 0.45, 1.0) * pow(1.0 - sqrt(1.0 - r2), 3.0) * 0.7;',
    '      } else if (r2 < 1.12) col += vec3(0.25, 0.45, 1.0) * (1.12 - r2) * 2.2;',
    '    }',
    '  }',
    '  if (uSunVis < 0.5) { gl_FragColor = vec4(col, 0.0); return; }',
    '  if (sd > 0.0 && d.y > -0.01) {',
    // круглое солнце: тёплый ореол, диск с затемнённым краем
    '    vec2 q = vec2(dot(d, uSunR), dot(d, uSunU)) / sd;',
    '    float m = length(q);',
    '    col += vec3(1.0, 0.76, 0.48) * (exp(-m * 11.0) * 0.26 + exp(-m * 3.5) * 0.06) * uSunK;',
    '    float disk = 1.0 - smoothstep(0.036, 0.043, m), r = m / 0.043;',
    '    col = mix(col, vec3(1.0, 0.95, 0.8) * uSunK * 1.2 * (1.0 - 0.4 * r * r), disk);',
    '  } else if (sd < 0.0 && d.y > -0.01) {',
    // луна-шар с фазами: граница света — эллипс, как у настоящей
    '    vec2 q = vec2(dot(d, uSunR), dot(d, uSunU)) / -sd;',
    '    float m = length(q), R0 = 0.034;',
    '    col += vec3(0.5, 0.6, 0.85) * exp(-m * 13.0) * 0.1 * uNight;',
    '    if (m < R0) {',
    '      vec2 n2 = q / R0;',
    '      vec3 n = vec3(n2, sqrt(max(1.0 - dot(n2, n2), 0.0)));',
    '      float ang = uMoon * 6.2832;',
    '      float lit = smoothstep(-0.06, 0.06, dot(n, vec3(sin(ang), 0.0, -cos(ang))));',
    '      float spot = step(0.62, fract(sin(dot(floor(q * 90.0), vec2(7.1, 3.7))) * 91.3)) + step(0.55, noise3(vec3(n2 * 3.0, 1.0))) * 0.6;',
    '      vec3 mc = mix(vec3(0.93, 0.94, 0.98), vec3(0.7, 0.72, 0.8), clamp(spot, 0.0, 1.0) * 0.55);',
    '      float edge = 1.0 - smoothstep(R0 * 0.92, R0, m);',
    '      col = mix(col, col + vec3(0.02, 0.025, 0.04) + mc * (1.0 + uSunK * 0.35) * lit, edge);',
    '    }',
    '  }',
    // альфа 0 — «здесь небо» (для лучей света в постобработке)
    '  gl_FragColor = vec4(col, 0.0);',
    '}'
  ].join('\n');

  // ---- Объёмные облака: коробки из карты облаков; сдвиг по ветру и перенос у края считаются на целую коробку ---
  var CLOUD3_VS = [
    'attribute vec2 aBox; attribute vec3 aLoc; attribute float aN;',
    'uniform mat4 uVP; uniform vec3 uCam; uniform float uOff; uniform float uY; uniform float uSpan;',
    'varying float vFace; varying float vDist;',
    'void main() {',
    '  vec2 o = aBox + vec2(uOff, 0.0);',
    '  o = mod(o - uCam.xz + uSpan * 0.5, uSpan) - uSpan * 0.5 + uCam.xz;',
    '  vec3 p = vec3(o.x + aLoc.x, uY + aLoc.y, o.y + aLoc.z);',
    '  vFace = aN; vDist = length(p.xz - uCam.xz);',
    '  gl_Position = uVP * vec4(p, 1.0);',
    '}'
  ].join('\n');
  var CLOUD3_FS = [
    'uniform vec3 uCol; uniform vec3 uFog; uniform float uFar; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uAlpha;',
    'varying float vFace; varying float vDist;',
    'void main() {',
    '  vec3 N = vFace < 0.5 ? vec3(1.0, 0.0, 0.0) : vFace < 1.5 ? vec3(-1.0, 0.0, 0.0) : vFace < 2.5 ? vec3(0.0, 1.0, 0.0) : vFace < 3.5 ? vec3(0.0, -1.0, 0.0) : vFace < 4.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 0.0, -1.0);',
    '  float sh = N.y > 0.5 ? 1.0 : N.y < -0.5 ? 0.8 : 0.9 - 0.04 * abs(N.x);',
    '  vec3 c = uCol * sh + uSunCol * max(dot(N, uSunDir), 0.0) * 0.35;',
    '  float f = smoothstep(uFar * 0.45, uFar, vDist);',
    '  gl_FragColor = vec4(mix(c, uFog, f), uAlpha * (1.0 - f));',
    '}'
  ].join('\n');

  var CLOUD_VS = [
    'attribute vec2 aPos;',
    'uniform mat4 uVP; uniform vec3 uCam; uniform float uSize; uniform float uY;',
    'varying vec2 vW; varying float vDist;',
    'void main() {',
    '  vec3 p = vec3(uCam.x + aPos.x * uSize, uY, uCam.z + aPos.y * uSize);',
    '  vW = p.xz; vDist = length(p.xz - uCam.xz);',
    '  gl_Position = uVP * vec4(p, 1.0);',
    '}'
  ].join('\n');
  var CLOUD_FS = [
    'uniform sampler2D uTex; uniform vec2 uOff; uniform float uCell; uniform vec3 uCol; uniform vec3 uFog; uniform float uFar;',
    'varying vec2 vW; varying float vDist;',
    'void main() {',
    '  vec2 uv = (vW + uOff) / (uCell * 64.0);',
    '  if (texture2D(uTex, uv).a < 0.5) discard;',
    '  float f = clamp(vDist / uFar, 0.0, 1.0); f *= f;',
    '  gl_FragColor = vec4(mix(uCol, uFog, f), 0.82 * (1.0 - f));',
    '}'
  ].join('\n');

  // ---- Мягкие частицы: свой атлас, цвет с прозрачностью; аддитивные гаснут в тумане ---------------
  var PART_VS = [
    'attribute vec3 aPos; attribute vec2 aUV; attribute vec4 aCol;',
    'uniform mat4 uVP; uniform vec3 uCamP; uniform vec2 uFogR;',
    'varying vec2 vUV; varying vec4 vCol; varying float vFog;',
    'void main() {',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '  vUV = aUV; vCol = aCol;',
    '  vFog = clamp((length(aPos.xz - uCamP.xz) - uFogR.x) / (uFogR.y - uFogR.x), 0.0, 1.0);',
    '}'
  ].join('\n');
  var PART_FS = [
    'uniform sampler2D uTex; uniform vec3 uFogC; uniform float uAdd;',
    'varying vec2 vUV; varying vec4 vCol; varying float vFog;',
    'void main() {',
    '  vec4 t = texture2D(uTex, vUV);',
    '  vec4 c = t * vCol;',
    '  if (uAdd > 0.5) { gl_FragColor = vec4(c.rgb * t.a * (1.0 - vFog), 1.0); return; }',
    '  if (c.a < 0.004) discard;',
    '  gl_FragColor = vec4(mix(c.rgb, uFogC, vFog), c.a);',
    '}'
  ].join('\n');

  var LINE_VS = 'attribute vec3 aPos; uniform mat4 uVP; void main() { gl_Position = uVP * vec4(aPos, 1.0); }';
  var LINE_FS = 'uniform vec4 uColor; void main() { gl_FragColor = uColor; }';

  // ---- Постобработка ----------------------------------------------------------------------------
  var POST_VS = 'attribute vec2 aPos; varying vec2 vUV; void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  // глубина сцены → расстояние от камеры и точка в пространстве камеры (uProj: ближняя, дальняя, tan по X и Y)
  var DEPTH_GLSL = [
    'uniform vec4 uProj;',
    'float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uProj.x * uProj.y / (uProj.y + uProj.x - z * (uProj.y - uProj.x)); }',
    'vec3 viewPos(vec2 uv, float d) { float z = linZ(d); return vec3((uv * 2.0 - 1.0) * uProj.zw * z, -z); }',
    // «переплетённый градиентный шум»: равномерная россыпь сдвигов, которую потом съедает размытие
    'float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }'
  ].join('\n');
  // Затенение в углах по глубине (SSAO): полусфера выборок вокруг нормали, восстановленной из соседних глубин
  var SSAO_FS = [
    'uniform sampler2D uDepth; uniform vec2 uTexel; uniform vec3 uKernel[SAMPLES]; uniform float uRadius;',
    'varying vec2 vUV;',
    'vec3 vpAt(vec2 uv) { return viewPos(uv, texture2D(uDepth, uv).r); }',
    'void main() {',
    '  float d = texture2D(uDepth, vUV).r;',
    '  if (d > 0.99999 || d < 0.0045) { gl_FragColor = vec4(1.0); return; }',
    '  vec3 P = viewPos(vUV, d);',
    '  vec3 pr = vpAt(vUV + vec2(uTexel.x, 0.0)), pl = vpAt(vUV - vec2(uTexel.x, 0.0));',
    '  vec3 pu = vpAt(vUV + vec2(0.0, uTexel.y)), pd = vpAt(vUV - vec2(0.0, uTexel.y));',
    '  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;',
    '  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;',
    '  vec3 N = normalize(cross(dx, dy));',
    '  float a = ign(gl_FragCoord.xy) * 6.2832;',
    '  vec3 T = normalize(cross(N, abs(N.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));',
    '  vec3 Bt = cross(N, T);',
    '  vec3 T2 = T * cos(a) + Bt * sin(a); vec3 B2 = Bt * cos(a) - T * sin(a);',
    '  float occ = 0.0;',
    '  for (int i = 0; i < SAMPLES; i++) {',
    '    vec3 k = uKernel[i];',
    '    vec3 s = P + (T2 * k.x + B2 * k.y + N * k.z) * uRadius;',
    '    vec2 suv = s.xy / (-s.z) / uProj.zw * 0.5 + 0.5;',
    '    float sz = linZ(texture2D(uDepth, suv).r);',
    '    float range = smoothstep(0.0, 1.0, uRadius / max(abs(-P.z - sz), 1e-3));',
    '    occ += step(sz, -s.z - 0.03) * range;',
    '  }',
    '  float ao = 1.0 - occ / float(SAMPLES);',
    // вдали затенение слабеет: там оно только шумит
    '  ao = mix(ao, 1.0, smoothstep(40.0, 90.0, -P.z));',
    '  gl_FragColor = vec4(ao, ao, ao, 1.0);',
    '}'
  ].join('\n');
  // Размытие по одной оси с учётом глубины: не смазывает туман и тени через края предметов
  var BLUR_FS = [
    'uniform sampler2D uSrc; uniform sampler2D uDepth; uniform vec2 uDir; uniform float uSharp;',
    'varying vec2 vUV;',
    'void main() {',
    '  float z0 = linZ(texture2D(uDepth, vUV).r);',
    '  vec4 acc = texture2D(uSrc, vUV) * 0.227; float ws = 0.227;',
    '  for (int i = 1; i <= 4; i++) {',
    '    float wg = i == 1 ? 0.1945 : i == 2 ? 0.1216 : i == 3 ? 0.0541 : 0.0162;',
    '    vec2 o = uDir * float(i);',
    '    float za = linZ(texture2D(uDepth, vUV + o).r), zb = linZ(texture2D(uDepth, vUV - o).r);',
    '    float wa = wg * exp(-abs(za - z0) / max(z0, 1.0) * uSharp), wb = wg * exp(-abs(zb - z0) / max(z0, 1.0) * uSharp);',
    '    acc += texture2D(uSrc, vUV + o) * wa + texture2D(uSrc, vUV - o) * wb;',
    '    ws += wa + wb;',
    '  }',
    '  gl_FragColor = acc / ws;',
    '}'
  ].join('\n');
  // Атмосфера в половинном разрешении: объёмный свет с тенями (лучи сквозь листву и между домами),
  // дымка, густеющая к земле, и объёмные облака. Итог: rgb — рассеянный свет, a — пропускание
  var ATMOS_FS = [
    'uniform sampler2D uDepth;',
    'uniform vec3 uCam; uniform vec3 uFwd; uniform vec3 uRight; uniform vec3 uUp;',
    'uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmbF; uniform vec4 uFogP; uniform float uFogFar;',
    'uniform float uTime; uniform float uPhaseG; uniform float uShOn;',
    '#ifdef VOLSH',
    'uniform sampler2D uShadow; uniform mat4 uLVP;',
    'float volShadow(vec3 p) {',
    '  vec3 s = (uLVP * vec4(p, 1.0)).xyz * 0.5 + 0.5;',
    '  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;',
    '  return step(s.z - 0.0015, texture2D(uShadow, s.xy).r);',
    '}',
    '#endif',
    'float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }',
    '#ifdef VCLOUDS',
    'uniform sampler2D uCloudTex; uniform vec4 uCloudP; uniform vec3 uCloudLit; uniform vec3 uCloudAmb; uniform float uCloudFar; uniform float uCloudK;',
    'float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vn(vec2 p) {',
    '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    // плотность облака: карта облаков (та же, что для их теней на земле) + клубящийся шум по краям
    'float cdens(vec3 p) {',
    '  vec2 q = p.xz + vec2(uCloudP.y, 0.0);',
    '  float cov = texture2D(uCloudTex, q / uCloudP.z).a + uCloudK;',
    '  if (cov < 0.03) return 0.0;',
    '  float h = clamp((p.y - uCloudP.x) / uCloudP.w, 0.0, 1.0);',
    '  float n = vn(q * 0.033 + vec2(uTime * 0.012, h)) * 0.6 + vn(q * 0.091 - vec2(h * 2.3, uTime * 0.02)) * 0.4;',
    '  float prof = smoothstep(0.0, 0.16, h) * (1.0 - smoothstep(0.3 + min(cov, 1.0) * 0.55, 1.0, h));',
    '  return clamp((cov * 1.15 - 0.42 + (n - 0.5) * 0.95) * 2.4, 0.0, 1.0) * prof;',
    '}',
    '#endif',
    'varying vec2 vUV;',
    'void main() {',
    '  float dz = texture2D(uDepth, vUV).r;',
    '  vec3 d = normalize(uFwd + (vUV.x * 2.0 - 1.0) * uProj.z * uRight + (vUV.y * 2.0 - 1.0) * uProj.w * uUp);',
    '  float dist = dz < 0.0045 ? 0.2 : dz > 0.99999 ? 1e5 : linZ(dz) / max(dot(d, uFwd), 0.05);',
    '  float j = ign(gl_FragCoord.xy);',
    '  float cosT = dot(d, uSunDir);',
    // рассеяние: сильный пик вперёд (сияние вокруг солнца, лучи) плюс ровная часть
    '  float ph = hg(cosT, uPhaseG) * 2.2 + 0.06;',
    '  vec3 fogS = vec3(0.0); float fogT = 1.0;',
    '  float fd = min(dist, uFogP.w);',
    '  float st = fd / float(VSTEPS);',
    '  for (int i = 0; i < VSTEPS; i++) {',
    '    vec3 p = uCam + d * ((float(i) + j) * st);',
    '    float den = uFogP.x * exp(-max(p.y - uFogP.z, 0.0) * uFogP.y);',
    '    float sh = 1.0;',
    '#ifdef VOLSH',
    '    if (uShOn > 0.5) sh = volShadow(p);',
    '#endif',
    '    float a = den * st;',
    '    fogS += fogT * a * (uSunCol * (sh * ph) + uAmbF);',
    '    fogT *= exp(-a);',
    '  }',
    // дальше объёма — дымка без теней до горизонта
    '  if (dist > fd) {',
    '    float rest = min(dist, uFogFar) - fd;',
    '    float hm = uCam.y + d.y * (fd + rest * 0.5);',
    '    float a = uFogP.x * exp(-max(hm - uFogP.z, 0.0) * uFogP.y) * rest;',
    '    float tr = exp(-a);',
    '    fogS += fogT * (1.0 - tr) * (uSunCol * ph * 0.85 + uAmbF);',
    '    fogT *= tr;',
    '  }',
    '  vec3 outS = fogS; float outT = fogT;',
    '#ifdef VCLOUDS',
    '  vec3 clS = vec3(0.0); float clT = 1.0;',
    '  float y0 = uCloudP.x, y1 = uCloudP.x + uCloudP.w, ta = 0.0, tb = -1.0;',
    '  if (abs(d.y) > 1e-4) { float t0 = (y0 - uCam.y) / d.y, t1 = (y1 - uCam.y) / d.y; ta = max(min(t0, t1), 0.0); tb = max(t0, t1); }',
    '  else if (uCam.y > y0 && uCam.y < y1) tb = uCloudFar;',
    '  tb = min(tb, min(dist, uCloudFar));',
    '  if (tb > ta) {',
    '    float cst = min(tb - ta, 150.0) / float(CSTEPS);',
    '    float t = ta + cst * j;',
    '    float cph = 0.55 + hg(cosT, 0.62) * 2.5;',
    '    for (int i = 0; i < CSTEPS; i++) {',
    '      vec3 p = uCam + d * t;',
    '      float den = cdens(p);',
    '      if (den > 0.01) {',
    // свет до солнца: оптическая толща по двум точкам; «пол» из многократного рассеяния не даёт облаку почернеть
    '        float od = (cdens(p + uSunDir * 4.0) * 4.0 + cdens(p + uSunDir * 11.0) * 7.0) * 0.15;',
    '        float lit = max(exp(-od), exp(-od * 0.25) * 0.4);',
    '        float h = clamp((p.y - y0) / uCloudP.w, 0.0, 1.0);',
    '        vec3 L = uCloudLit * (lit * cph) + uCloudAmb * (0.62 + 0.38 * h);',
    '        float tr = exp(-den * cst * 0.16);',
    '        clS += clT * (1.0 - tr) * L;',
    '        clT *= tr;',
    '        if (clT < 0.03) break;',
    '      }',
    '      t += cst;',
    '    }',
    // дальние облака тают в дымке у горизонта
    '    float fade = smoothstep(uCloudFar * 0.5, uCloudFar, ta);',
    '    clS *= 1.0 - fade; clT = mix(clT, 1.0, fade);',
    '  }',
    '  if (uCam.y < y0) outS = fogS + fogT * clS; else outS = clS + clT * fogS;',
    '  outT = fogT * clT;',
    '#endif',
    '  gl_FragColor = vec4(outS, outT);',
    '}'
  ].join('\n');
  // первый шаг свечения: уменьшение вдвое и отбор ярких пикселей с мягким порогом
  var BLOOM_PRE_FS = [
    'uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec2 uThr;',
    '#ifdef ATMOS',
    'uniform sampler2D uAtm;',
    '#endif',
    'varying vec2 vUV;',
    'void main() {',
    '  vec3 c = texture2D(uSrc, vUV + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(uSrc, vUV + uTexel * vec2(0.5, -0.5)).rgb',
    '    + texture2D(uSrc, vUV + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(uSrc, vUV + uTexel * vec2(0.5, 0.5)).rgb;',
    '  c *= 0.25;',
    // свечение считается уже сквозь облака и дымку: солнце за тучей не слепит
    '#ifdef ATMOS',
    '  vec4 at = texture2D(uAtm, vUV); c = c * at.a + at.rgb;',
    '#endif',
    '  float l = max(c.r, max(c.g, c.b));',
    '  float s = clamp(l - uThr.x + uThr.y, 0.0, 2.0 * uThr.y);',
    '  s = s * s / (4.0 * uThr.y + 1e-4);',
    '  float k = max(s, l - uThr.x) / max(l, 1e-4);',
    '  gl_FragColor = vec4(min(c * k, vec3(16.0)), 1.0);',
    '}'
  ].join('\n');
  var BLOOM_DOWN_FS = [
    'uniform sampler2D uSrc; uniform vec2 uTexel;',
    'varying vec2 vUV;',
    'void main() {',
    '  vec3 c = texture2D(uSrc, vUV).rgb * 0.5;',
    '  c += texture2D(uSrc, vUV + uTexel * vec2(-1.0, -1.0)).rgb * 0.125 + texture2D(uSrc, vUV + uTexel * vec2(1.0, -1.0)).rgb * 0.125;',
    '  c += texture2D(uSrc, vUV + uTexel * vec2(-1.0, 1.0)).rgb * 0.125 + texture2D(uSrc, vUV + uTexel * vec2(1.0, 1.0)).rgb * 0.125;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');
  var BLOOM_UP_FS = [
    'uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uK;',
    'varying vec2 vUV;',
    'void main() {',
    '  vec3 c = texture2D(uSrc, vUV).rgb * 4.0;',
    '  c += (texture2D(uSrc, vUV + vec2(uTexel.x, 0.0)).rgb + texture2D(uSrc, vUV - vec2(uTexel.x, 0.0)).rgb',
    '     + texture2D(uSrc, vUV + vec2(0.0, uTexel.y)).rgb + texture2D(uSrc, vUV - vec2(0.0, uTexel.y)).rgb) * 2.0;',
    '  c += texture2D(uSrc, vUV + uTexel).rgb + texture2D(uSrc, vUV - uTexel).rgb',
    '     + texture2D(uSrc, vUV + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(uSrc, vUV + vec2(-uTexel.x, uTexel.y)).rgb;',
    '  gl_FragColor = vec4(c / 16.0 * uK, 1.0);',
    '}'
  ].join('\n');
  var COMPOSITE_FS = [
    'uniform sampler2D uScene; uniform sampler2D uBloom; uniform float uBloomK; uniform float uExposure;',
    'uniform vec3 uLift; uniform vec3 uGain; uniform float uSat; uniform float uContrast; uniform float uVignette;',
    'uniform float uTime; uniform float uWave; uniform vec4 uTint; uniform vec2 uTexel;',
    'uniform vec3 uSunScr; uniform vec3 uRayCol;',
    '#ifdef SSAO',
    'uniform sampler2D uAO; uniform float uAOK;',
    '#endif',
    '#ifdef ATMOS',
    'uniform sampler2D uAtm;',
    '#endif',
    'varying vec2 vUV;',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    '#ifdef FILMIC',
    // киношная кривая (приближение ACES): мягкие тени, плотные полутона, светлое уходит в белое без «ступеньки»
    'vec3 tone(vec3 x) { x *= 0.92; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }',
    '#else',
    // мягкое плечо: до 0.72 цвет не трогаем, выше плавно подводим к 1 — привычная картинка без пересветов
    'vec3 tone(vec3 x) { vec3 k = max(x - 0.72, 0.0); return min(x, vec3(0.72)) + 0.28 * (1.0 - exp(-k / 0.28)); }',
    '#endif',
    'void main() {',
    '  vec2 uv = vUV;',
    '  if (uWave > 0.0) uv += vec2(sin(uv.y * 23.0 + uTime * 2.1), cos(uv.x * 19.0 + uTime * 1.7)) * 0.0035 * uWave;',
    '  vec3 c = texture2D(uScene, uv).rgb;',
    '#ifdef SSAO',
    '  c *= mix(1.0, texture2D(uAO, uv).r, uAOK);',
    '#endif',
    '#ifdef ATMOS',
    '  vec4 at = texture2D(uAtm, uv);',
    '  c = c * at.a + at.rgb;',
    '#endif',
    '#ifdef BLOOM',
    '  c += texture2D(uBloom, uv).rgb * uBloomK;',
    '#endif',
    '#ifdef RAYS',
    // лучи: радиальное размытие неба в сторону солнца
    '  if (uSunScr.z > 0.0) {',
    '    vec2 dlt = (uSunScr.xy - uv) / 28.0;',
    '    vec2 p = uv; float acc = 0.0; float w = 1.0;',
    '    for (int i = 0; i < 28; i++) {',
    '      p += dlt;',
    '      vec4 s = texture2D(uScene, clamp(p, 0.0, 1.0));',
    '      acc += (1.0 - s.a) * dot(s.rgb, vec3(0.3, 0.5, 0.2)) * w;',
    '      w *= 0.955;',
    '    }',
    '    c += uRayCol * acc / 28.0 * uSunScr.z;',
    '  }',
    '#endif',
    '  c *= uExposure;',
    '  c = tone(c);',
    '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  c = mix(vec3(l), c, uSat);',
    '  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);',
    '  c = c * uGain + uLift * (1.0 - c);',
    '  c = mix(c, uTint.rgb, uTint.a);',
    '  vec2 q = vUV - 0.5;',
    '  c *= 1.0 - uVignette * dot(q, q) * 1.6;',
    '  c += (hash(gl_FragCoord.xy + fract(uTime) * 71.0) - 0.5) / 255.0;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  // ---- Возможности видеокарты -------------------------------------------------------------------
  function detect(gl) {
    var gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    var caps = { gl2: gl2, depthTex: false, half: null, msaa: 0 };
    if (gl2) {
      caps.depthTex = true;
      if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) caps.half = 'gl2';
      caps.msaa = gl.getParameter(gl.MAX_SAMPLES) || 0;
    } else {
      caps.depthExt = gl.getExtension('WEBGL_depth_texture');
      caps.depthTex = !!caps.depthExt;
      var hf = gl.getExtension('OES_texture_half_float');
      if (hf) {
        gl.getExtension('OES_texture_half_float_linear');
        gl.getExtension('EXT_color_buffer_half_float');
        caps.halfType = hf.HALF_FLOAT_OES;
        caps.half = 'gl1';
      }
    }
    caps.fragUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 16;
    return caps;
  }

  function Renderer(canvas) {
    var opts = { antialias: false, alpha: false, depth: true, powerPreference: 'high-performance' };
    var gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('no-webgl');
    this.gl = gl;
    this.canvas = canvas;
    this.caps = detect(gl);
    // качество по умолчанию — «среднее» без теней; game.js задаёт своё через setQuality
    this.q = { lights: 8, sway: true, fancy: true, shadows: 0, pcf: 1, shadowHalf: 44, post: false, bloom: true, msaa: 0, rays: false, cloudShadows: false, clouds3d: false,
      ssao: 0, vol: 0, vclouds: 0, water: 0, filmic: false };
    this.fx = { ssao: false, atm: false, water: false };
    // ядро SSAO: точки в полусфере, гуще к центру
    var kr = KC.mulberry32 ? KC.mulberry32(9127) : Math.random;
    this.kernel = new Float32Array(16 * 3);
    for (var ki = 0; ki < 16; ki++) {
      var kx = kr() * 2 - 1, ky = kr() * 2 - 1, kz = 0.15 + kr() * 0.85, kl = Math.hypot(kx, ky, kz) || 1, ks = 0.12 + 0.88 * Math.pow((ki + 1) / 16, 2);
      this.kernel[ki * 3] = kx / kl * ks; this.kernel[ki * 3 + 1] = ky / kl * ks; this.kernel[ki * 3 + 2] = kz / kl * ks;
    }
    this.nl = 1;
    this.w = canvas.width || 1; this.h = canvas.height || 1;
    this.lp = new Float32Array(32); this.lc = new Float32Array(32); this.ld = new Float32Array(32);
    this.lvp = new Float32Array(16);

    this.line = this.program(LINE_VS, HP + LINE_FS, ['aPos']);
    this.sky = this.program(SKY_VS, HP + SKY_FS, ['aPos']);
    this.cloud = this.program(CLOUD_VS, HP + CLOUD_FS, ['aPos']);
    this.cloud3 = this.program(CLOUD3_VS, HP + CLOUD3_FS, ['aBox', 'aLoc', 'aN']);
    this.part = this.program(PART_VS, HP + PART_FS, ['aPos', 'aUV', 'aCol']);
    this.shadowProg = this.program(SHADOW_VS, HP + SHADOW_FS, ['aPos', 'aUV']);
    this.bloomDown = this.program(POST_VS, HP + BLOOM_DOWN_FS, ['aPos']);
    this.bloomUp = this.program(POST_VS, HP + BLOOM_UP_FS, ['aPos']);
    this.build();

    var idx = new Uint16Array(MAX_QUADS * 6);
    for (var q = 0; q < MAX_QUADS; q++) {
      var v = q * 4, o = q * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    this.white = this.pixelTex([255, 255, 255, 255]);
    this.clearAtm = this.pixelTex([0, 0, 0, 255]);
    this.fsTri = this.staticBuffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
    this.quad = this.staticBuffer(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    this.lineBuf = gl.createBuffer();
    this.dynBuf = gl.createBuffer();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.vp = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.handProj = new Float32Array(16);
    this.view = new Float32Array(16);
    this.planes = new Float32Array(24);
    this.stats = { chunks: 0, quads: 0, shadowChunks: 0 };
  }

  // Программа: имена униформ собираются из текста шейдеров
  Renderer.prototype.program = function (vs, fs, attrs) {
    var gl = this.gl;
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    attrs.forEach(function (a, i) { gl.bindAttribLocation(p, i, a); });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('link: ' + gl.getProgramInfoLog(p));
    var u = {}, re = /uniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+([A-Za-z_]\w*)/g, m, src = vs + '\n' + fs;
    while ((m = re.exec(src))) if (!(m[1] in u)) u[m[1]] = gl.getUniformLocation(p, m[1]);
    return { p: p, u: u };
  };

  // Пересборка программ, зависящих от настроек качества
  Renderer.prototype.build = function () {
    var gl = this.gl, q = this.q, caps = this.caps;
    var maxL = caps.fragUniforms >= 128 ? 8 : caps.fragUniforms >= 64 ? 4 : 1;
    this.nl = Math.max(1, Math.min(maxL, q.lights | 0));
    this.shadowsOn = !!(q.shadows && caps.depthTex && q.fancy);
    // эффекты по буферу глубины: затенение в углах, атмосфера, вода с отражениями (последней нужен WebGL2)
    var fx = this.fx;
    fx.ssao = !!(q.post && q.ssao && caps.depthTex);
    fx.atm = !!(q.post && (q.vol || q.vclouds) && caps.depthTex);
    fx.water = !!(q.post && q.water && q.fancy && caps.gl2);
    var defs = '#define NL ' + this.nl + '\n' + TILE_DEFS + (q.sway ? '#define SWAY 1\n' : '') + (q.fancy ? '#define FANCY 1\n' : '') +
      (this.shadowsOn ? '#define SHADOWS ' + (q.pcf > 1 ? 2 : 1) + '\n' : '') + (q.cloudShadows && q.fancy ? '#define CLOUDSH 1\n' : '');
    var wdefs = fx.water ? '#define WATERFX 1\n#define SSR_STEPS ' + (q.water > 1 ? 22 : 14) + '\n' : '';
    [this.block, this.ent, this.composite, this.bloomPre, this.ssao, this.blur, this.atmos].forEach(function (P) { if (P) gl.deleteProgram(P.p); });
    this.block = this.program(defs + BLOCK_VS, HP + defs + wdefs + BLOCK_FS, ['aPos', 'aUV', 'aLight']);
    this.ent = this.program(defs + ENT_VS, HP + defs + ENT_FS, ['aPos', 'aUV', 'aCol']);
    var pdefs = (q.bloom ? '#define BLOOM 1\n' : '') + (q.rays && !fx.atm ? '#define RAYS 1\n' : '') + (fx.ssao ? '#define SSAO 1\n' : '') +
      (fx.atm ? '#define ATMOS 1\n' : '') + (q.filmic ? '#define FILMIC 1\n' : '');
    this.composite = this.program(POST_VS, HP + pdefs + COMPOSITE_FS, ['aPos']);
    this.bloomPre = this.program(POST_VS, HP + (fx.atm ? '#define ATMOS 1\n' : '') + BLOOM_PRE_FS, ['aPos']);
    this.ssao = fx.ssao ? this.program(POST_VS, HP + '#define SAMPLES ' + (q.ssao > 1 ? 16 : 10) + '\n' + DEPTH_GLSL + '\n' + SSAO_FS, ['aPos']) : null;
    this.blur = fx.ssao || fx.atm ? this.program(POST_VS, HP + DEPTH_GLSL + '\n' + BLUR_FS, ['aPos']) : null;
    this.atmos = fx.atm ? this.program(POST_VS, HP + '#define VSTEPS ' + (q.vol > 1 ? 16 : q.vol ? 10 : 2) + '\n' +
      (q.vclouds ? '#define VCLOUDS 1\n#define CSTEPS ' + (q.vclouds > 1 ? 14 : 9) + '\n' : '') + (this.shadowsOn && q.vol ? '#define VOLSH 1\n' : '') +
      DEPTH_GLSL + '\n' + ATMOS_FS, ['aPos']) : null;
  };

  Renderer.prototype.setQuality = function (q) {
    var changed = false;
    for (var k in q) if (this.q[k] !== q[k]) { this.q[k] = q[k]; changed = true; }
    if (!changed && this.built) return;
    this.built = true;
    this.build();
    this.setupTargets();
  };

  Renderer.prototype.staticBuffer = function (data) {
    var gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  };

  Renderer.prototype.texture = function (source, repeat) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    var wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  };

  Renderer.prototype.pixelTex = function (rgba) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  };

  // Атлас блоков с мип-уровнями: вдали кирпич и листва не рябят. Уровни считаем сами, по плиткам 16×16,
  // до уровня 4 (плитка — один пиксель), поэтому соседние плитки не смешиваются. Цвет усредняем по
  // непрозрачным пикселям (без тёмной каймы), прозрачность чуть завышаем — кроны вдали остаются густыми
  Renderer.prototype.setAtlas = function (canvas) {
    var gl = this.gl, t = this.texture(canvas, false), w = canvas.width, h = canvas.height;
    if ((w & (w - 1)) || (h & (h - 1))) { this.atlas = t; return; }
    var src = canvas.getContext('2d').getImageData(0, 0, w, h).data, lvl = 0, maxLvl = this.caps.gl2 ? 4 : 99;
    while ((w > 1 || h > 1) && lvl < maxLvl) {
      var nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), dst = new Uint8Array(nw * nh * 4);
      for (var y = 0; y < nh; y++) for (var x = 0; x < nw; x++) {
        var r = 0, g = 0, b = 0, a = 0;
        for (var k = 0; k < 4; k++) {
          var sx = Math.min(w - 1, x * 2 + (k & 1)), sy = Math.min(h - 1, y * 2 + (k >> 1)), o = (sx + sy * w) * 4, al = src[o + 3];
          r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al;
        }
        var q = (x + y * nw) * 4;
        if (a > 0) { dst[q] = r / a; dst[q + 1] = g / a; dst[q + 2] = b / a; }
        dst[q + 3] = Math.min(255, a / 4 * 1.35);
      }
      lvl++;
      gl.texImage2D(gl.TEXTURE_2D, lvl, gl.RGBA, nw, nh, 0, gl.RGBA, gl.UNSIGNED_BYTE, dst);
      src = dst; w = nw; h = nh;
    }
    if (this.caps.gl2) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, lvl);
    // без анизотропии: в Direct3D она включает сглаживание и вблизи, а пиксели должны оставаться чёткими
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    this.atlas = t;
  };
  // Атлас частиц: мягкие края, поэтому линейная фильтрация и мипы (не глубже 8 пикселей на клетку)
  Renderer.prototype.setParticleTex = function (canvas) {
    var gl = this.gl, t = this.texture(canvas, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (this.caps.gl2) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 2);
    this.partTex = t;
  };
  Renderer.prototype.setMobAtlas = function (canvas) { this.mobAtlas = this.texture(canvas, false); };

  Renderer.prototype.makeClouds = function (seed) {
    var n = 64, rnd = KC.mulberry32(seed * 31 + 7), g = new Float32Array(n * n), i, x, y;
    for (i = 0; i < n * n; i++) g[i] = rnd();
    for (var pass = 0; pass < 3; pass++) {
      var ng = new Float32Array(n * n);
      for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
        var s = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) s += g[((x + dx + n) % n) + ((y + dy + n) % n) * n];
        ng[x + y * n] = s / 9;
      }
      g = ng;
    }
    var cv = document.createElement('canvas');
    cv.width = cv.height = n;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(n, n);
    for (i = 0; i < n * n; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = g[i] > 0.55 ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
    var gl = this.gl;
    if (this.cloudTex) gl.deleteTexture(this.cloudTex);
    if (this.cloudSoft) gl.deleteTexture(this.cloudSoft);
    this.cloudTex = this.texture(cv, true);
    // размытая копия с линейной фильтрацией — для мягких теней облаков на земле
    this.cloudSoft = this.texture(cv, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.cloudMap = g;
    this.buildCloudMesh(g, n);
  };

  // Сетка облаков: клетка 12×12 блоков, толщина 4; грани между соседними облаками не рисуем
  var CLOUD_CELL = 12, CLOUD_H = 4;
  Renderer.prototype.buildCloudMesh = function (g, n) {
    var gl = this.gl, data = [], filled = function (x, y) { return g[((x + n) % n) + ((y + n) % n) * n] > 0.55; };
    var C = CLOUD_CELL, Hh = CLOUD_H;
    function quad(bx, bz, pts, f) {
      var order = [0, 1, 2, 0, 2, 3];
      for (var i = 0; i < 6; i++) { var p = pts[order[i]]; data.push(bx, bz, p[0], p[1], p[2], f); }
    }
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      if (!filled(x, y)) continue;
      var bx = x * C, bz = y * C;
      // вершины по часовой стрелке снаружи → лицевые грани против часовой (как у остального мира)
      quad(bx, bz, [[0, Hh, 0], [0, Hh, C], [C, Hh, C], [C, Hh, 0]], 2);
      quad(bx, bz, [[0, 0, 0], [C, 0, 0], [C, 0, C], [0, 0, C]], 3);
      if (!filled(x + 1, y)) quad(bx, bz, [[C, 0, 0], [C, Hh, 0], [C, Hh, C], [C, 0, C]], 0);
      if (!filled(x - 1, y)) quad(bx, bz, [[0, 0, 0], [0, 0, C], [0, Hh, C], [0, Hh, 0]], 1);
      if (!filled(x, y + 1)) quad(bx, bz, [[0, 0, C], [C, 0, C], [C, Hh, C], [0, Hh, C]], 4);
      if (!filled(x, y - 1)) quad(bx, bz, [[0, 0, 0], [0, Hh, 0], [C, Hh, 0], [C, 0, 0]], 5);
    }
    if (this.cloudVbo) gl.deleteBuffer(this.cloudVbo);
    this.cloudVbo = this.staticBuffer(new Float32Array(data));
    this.cloudVerts = data.length / 6;
  };

  // ---- Буферы кадра: сцена, сглаживание, свечение, тени ---------------------------------------------
  Renderer.prototype.colorTex = function (w, h, hdr) {
    var gl = this.gl, caps = this.caps, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (hdr && caps.half === 'gl2') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else if (hdr && caps.half === 'gl1') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, caps.halfType, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // текстура глубины: её читают затенение в углах, атмосфера и вода
  Renderer.prototype.depthTexture = function (w, h) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (this.caps.gl2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  Renderer.prototype.fboFor = function (tex, depthRb, depthTex) {
    var gl = this.gl, f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (depthRb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
    if (depthTex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok ? f : (gl.deleteFramebuffer(f), null);
  };

  Renderer.prototype.freeTargets = function () {
    var gl = this.gl, T = this.T;
    if (!T) return;
    (T.texs || []).forEach(function (t) { gl.deleteTexture(t); });
    (T.fbos || []).forEach(function (f) { if (f) gl.deleteFramebuffer(f); });
    (T.rbs || []).forEach(function (r) { gl.deleteRenderbuffer(r); });
    this.T = null;
  };

  Renderer.prototype.setupTargets = function () {
    var gl = this.gl, q = this.q, caps = this.caps, w = this.w, h = this.h;
    this.freeTargets();
    this.setupShadow();
    if (!q.post) return;
    var T = { texs: [], fbos: [], rbs: [], levels: [] }, fx = this.fx;
    var tryHdr = !!caps.half, wantDT = fx.ssao || fx.atm || fx.water;
    // пробуем: HDR с текстурой глубины → HDR с обычной глубиной → то же без HDR
    var tries = [[tryHdr, wantDT], [tryHdr, false], [false, wantDT], [false, false]];
    for (var attempt = 0; attempt < tries.length; attempt++) {
      var hdr = tries[attempt][0], useDT = tries[attempt][1];
      if ((hdr && !tryHdr) || (useDT && !wantDT)) continue;
      var depth = null, dtex = null;
      if (useDT) dtex = this.depthTexture(w, h);
      else {
        depth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, caps.gl2 ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT16, w, h);
      }
      var sceneTex = this.colorTex(w, h, hdr);
      var sceneFbo = this.fboFor(sceneTex, depth, dtex);
      if (sceneFbo) {
        T.hdr = hdr; T.sceneTex = sceneTex; T.sceneFbo = sceneFbo; T.depthTex = dtex; T.texs.push(sceneTex); T.fbos.push(sceneFbo);
        if (depth) T.rbs.push(depth);
        if (dtex) T.texs.push(dtex);
        break;
      }
      gl.deleteTexture(sceneTex); if (depth) gl.deleteRenderbuffer(depth); if (dtex) gl.deleteTexture(dtex);
    }
    if (!T.sceneFbo) { this.T = null; return; }
    if (wantDT && !T.depthTex) {
      // глубину в текстуру не дают — эффекты по глубине выключаем
      caps.depthTex = false; this.build();
    }
    // сглаживание MSAA: рисуем в многосэмпловый буфер и «сводим» в текстуру сцены
    if (q.msaa && caps.gl2 && caps.msaa) {
      var samples = Math.min(q.msaa, caps.msaa);
      var mc = gl.createRenderbuffer(), md = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, mc);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, T.hdr ? gl.RGBA16F : gl.RGBA8, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, md);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      var mf = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, mf);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, mc);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, md);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) { T.msFbo = mf; T.fbos.push(mf); T.rbs.push(mc, md); }
      else { gl.deleteFramebuffer(mf); gl.deleteRenderbuffer(mc); gl.deleteRenderbuffer(md); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // половинное разрешение: затенение в углах и атмосфера (по паре буферов для размытия туда-обратно)
    var self = this, hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    var half = function (hdrT) {
      var tx = self.colorTex(hw, hh, hdrT), fb = self.fboFor(tx, null);
      if (!fb) { gl.deleteTexture(tx); return null; }
      T.texs.push(tx); T.fbos.push(fb);
      return { tex: tx, fbo: fb, w: hw, h: hh };
    };
    if (this.fx.ssao && T.depthTex) { T.ao = [half(false), half(false)]; if (!T.ao[0] || !T.ao[1]) T.ao = null; }
    if (this.fx.atm && T.depthTex) { T.atm = [half(T.hdr), half(T.hdr)]; if (!T.atm[0] || !T.atm[1]) T.atm = null; }
    // копия сцены перед водой: вода преломляет и отражает то, что уже нарисовано
    if (this.fx.water) {
      var rt = this.colorTex(w, h, T.hdr), rd = this.depthTexture(w, h), rf = this.fboFor(rt, null, rd);
      if (rf) { T.refr = { tex: rt, dtex: rd, fbo: rf }; T.texs.push(rt, rd); T.fbos.push(rf); }
      else { gl.deleteTexture(rt); gl.deleteTexture(rd); }
    }
    if (q.bloom) {
      var lw = w, lh = h;
      for (var i = 0; i < 5; i++) {
        lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
        if (i > 1 && (lw < 8 || lh < 8)) break;
        var tx = this.colorTex(lw, lh, T.hdr), fb = this.fboFor(tx, null);
        if (!fb) { gl.deleteTexture(tx); break; }
        T.texs.push(tx); T.fbos.push(fb);
        T.levels.push({ tex: tx, fbo: fb, w: lw, h: lh });
      }
    }
    this.T = T;
  };

  Renderer.prototype.setupShadow = function () {
    var gl = this.gl, caps = this.caps, S = this.S;
    var size = this.shadowsOn ? (this.q.shadows | 0) : 0;
    if (S && S.size === size) return;
    if (S) { gl.deleteTexture(S.tex); gl.deleteFramebuffer(S.fbo); if (S.rb) gl.deleteRenderbuffer(S.rb); this.S = null; }
    if (!size) return;
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (caps.gl2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var f = gl.createFramebuffer(), rb = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      // некоторые WebGL1 требуют цветное вложение
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, size, size);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    }
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteTexture(t); gl.deleteFramebuffer(f); if (rb) gl.deleteRenderbuffer(rb);
      this.shadowsOn = false; this.build();
      return;
    }
    this.S = { size: size, tex: t, fbo: f, rb: rb };
  };

  Renderer.prototype.resize = function (w, h) {
    this.canvas.width = w; this.canvas.height = h;
    this.w = w; this.h = h;
    this.gl.viewport(0, 0, w, h);
    if (this.built) this.setupTargets();
  };

  Renderer.prototype.uploadMesh = function (chunk, m) {
    var gl = this.gl;
    this.deleteMesh(chunk);
    var mesh = { opaque: null, opaqueQuads: m.opaqueQuads, water: null, waterQuads: m.waterQuads, topY: m.topY };
    if (m.opaqueQuads) {
      mesh.opaque = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.opaque);
      gl.bufferData(gl.ARRAY_BUFFER, m.opaque, gl.STATIC_DRAW);
    }
    if (m.waterQuads) {
      mesh.water = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.water);
      gl.bufferData(gl.ARRAY_BUFFER, m.water, gl.STATIC_DRAW);
    }
    chunk.mesh = mesh;
  };

  Renderer.prototype.deleteMesh = function (chunk) {
    if (!chunk.mesh) return;
    if (chunk.mesh.opaque) this.gl.deleteBuffer(chunk.mesh.opaque);
    if (chunk.mesh.water) this.gl.deleteBuffer(chunk.mesh.water);
    chunk.mesh = null;
  };

  Renderer.prototype.drawQuads = function (vbo, quads) {
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (var start = 0; start < quads; start += MAX_QUADS) {
      var n = Math.min(MAX_QUADS, quads - start), base = start * 4 * STRIDE;
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, base);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, base + 12);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, STRIDE, base + 20);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    }
  };

  // Вершины частиц: позиция, UV, цвет с альфой — 9 чисел
  Renderer.prototype.drawRange9 = function (startQuad, count) {
    var gl = this.gl, S9 = 36;
    for (var start = 0; start < count; start += MAX_QUADS) {
      var n = Math.min(MAX_QUADS, count - start), base = (startQuad + start) * 4 * S9;
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S9, base);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S9, base + 12);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, S9, base + 20);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    }
  };

  Renderer.prototype.drawDynamic = function (data, quads) {
    if (!quads) return;
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.drawQuads(this.dynBuf, quads);
  };

  function perspective(p, fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2);
    p.fill(0);
    p[0] = f / aspect; p[5] = f; p[10] = (far + near) / (near - far); p[11] = -1; p[14] = 2 * far * near / (near - far);
  }

  Renderer.prototype.setCamera = function (cam, fov, aspect, far) {
    perspective(this.proj, fov, aspect, 0.08, far);
    this.near = 0.08;
    perspective(this.handProj, 70 * Math.PI / 180, aspect, 0.02, 10);
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var r00 = cy, r01 = 0, r02 = -sy;
    var r10 = sp * sy, r11 = cp, r12 = sp * cy;
    var r20 = cp * sy, r21 = -sp, r22 = cp * cy;
    var v = this.view;
    v[0] = r00; v[4] = r01; v[8] = r02;
    v[1] = r10; v[5] = r11; v[9] = r12;
    v[2] = r20; v[6] = r21; v[10] = r22;
    v[3] = 0; v[7] = 0; v[11] = 0; v[15] = 1;
    v[12] = -(r00 * cam.x + r01 * cam.y + r02 * cam.z);
    v[13] = -(r10 * cam.x + r11 * cam.y + r12 * cam.z);
    v[14] = -(r20 * cam.x + r21 * cam.y + r22 * cam.z);
    mul4(this.vp, this.proj, v);
    this.fwd = [-sy * cp, sp, -cy * cp];
    this.right = [cy, 0, -sy];
    this.up = [sy * sp, cp, cy * sp];
    this.tanH = Math.tan(fov / 2);
    this.aspect = aspect;
    this.far = far;
    var m = this.vp, pl = this.planes;
    for (var i = 0; i < 3; i++) for (var s = 0; s < 2; s++) {
      var k = (i * 2 + s) * 4, sign = s ? -1 : 1;
      pl[k] = m[3] + sign * m[i];
      pl[k + 1] = m[7] + sign * m[4 + i];
      pl[k + 2] = m[11] + sign * m[8 + i];
      pl[k + 3] = m[15] + sign * m[12 + i];
    }
  };

  function mul4(out, a, b) {
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }

  // Точка мира → экран (0…1) или null, если за спиной
  Renderer.prototype.project = function (x, y, z) {
    var m = this.vp;
    var cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.01) return null;
    return [cx / cw * 0.5 + 0.5, cy / cw * 0.5 + 0.5];
  };

  Renderer.prototype.boxVisible = function (x0, y0, z0, x1, y1, z1) {
    var pl = this.planes;
    for (var i = 0; i < 6; i++) {
      var k = i * 4, a = pl[k], b = pl[k + 1], c = pl[k + 2], d = pl[k + 3];
      if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? y1 : y0) + c * (c > 0 ? z1 : z0) + d < 0) return false;
    }
    return true;
  };

  // ---- Униформы освещения ------------------------------------------------------------------------
  Renderer.prototype.packLights = function (list) {
    var n = this.nl, lp = this.lp, lc = this.lc, ld = this.ld;
    lp.fill(0); lc.fill(0); ld.fill(0);
    this.numL = list ? Math.min(n, list.length) : 0;
    for (var i = 0; i < n && list && i < list.length; i++) {
      var L = list[i], o = i * 4;
      lp[o] = L.x; lp[o + 1] = L.y; lp[o + 2] = L.z; lp[o + 3] = L.r;
      lc[o] = L.col[0]; lc[o + 1] = L.col[1]; lc[o + 2] = L.col[2]; lc[o + 3] = L.cone === undefined ? -2 : L.cone;
      if (L.dir) { ld[o] = L.dir[0]; ld[o + 1] = L.dir[1]; ld[o + 2] = L.dir[2]; }
    }
  };
  Renderer.prototype.dynUniforms = function (P) {
    var gl = this.gl, n = this.nl;
    gl.uniform1f(P.u.uNumL, this.numL || 0);
    gl.uniform4fv(P.u.uLP, this.lp.subarray(0, n * 4));
    gl.uniform4fv(P.u.uLC, this.lc.subarray(0, n * 4));
    gl.uniform4fv(P.u.uLD, this.ld.subarray(0, n * 4));
  };

  Renderer.prototype.useEnt = function (tex, env, vp, cam, noFog) {
    var gl = this.gl, E = this.ent, L = env.light || KC.Light;
    gl.useProgram(E.p);
    gl.uniformMatrix4fv(E.u.uVP, false, vp);
    gl.uniform3f(E.u.uCam, cam[0], cam[1], cam[2]);
    gl.uniform3fv(E.u.uFog, env.fog.color);
    gl.uniform3fv(E.u.uFogSun, L.fogSun || env.fog.color);
    gl.uniform3fv(E.u.uSunDir, L.sunDir);
    if (noFog) gl.uniform2f(E.u.uFogR, 1000, 2000);
    else gl.uniform2f(E.u.uFogR, env.fog.start, env.fog.end);
    gl.uniform1f(E.u.uAlpha, 1);
    gl.uniform1f(E.u.uCut, 0.5);
    gl.uniform1f(E.u.uDyn, noFog ? 0 : 1);
    this.dynUniforms(E);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(E.u.uTex, 0);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    return E;
  };

  // ---- Проход теней ---------------------------------------------------------------------------------
  // Ортопроекция вдоль луча светила вокруг камеры; центр привязан к сетке текселей — тени не «дрожат»
  Renderer.prototype.shadowPass = function (env) {
    var gl = this.gl, S = this.S, L = env.light || KC.Light, cam = env.cam;
    var half = this.q.shadowHalf || 44, depth = 160;
    var Ld = L.shadowDir || L.sunDir;
    var up = Math.abs(Ld[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
    var ax = [up[1] * Ld[2] - up[2] * Ld[1], up[2] * Ld[0] - up[0] * Ld[2], up[0] * Ld[1] - up[1] * Ld[0]];
    var al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    ax = [ax[0] / al, ax[1] / al, ax[2] / al];
    var ay = [Ld[1] * ax[2] - Ld[2] * ax[1], Ld[2] * ax[0] - Ld[0] * ax[2], Ld[0] * ax[1] - Ld[1] * ax[0]];
    // центр чуть впереди взгляда — больше теней там, куда смотрим
    var fx = this.fwd[0], fz = this.fwd[2], fl = Math.hypot(fx, fz) || 1;
    var c = [cam.x + fx / fl * half * 0.3, cam.y, cam.z + fz / fl * half * 0.3];
    var texel = 2 * half / S.size;
    var cx = Math.round((c[0] * ax[0] + c[1] * ax[1] + c[2] * ax[2]) / texel) * texel;
    var cy = Math.round((c[0] * ay[0] + c[1] * ay[1] + c[2] * ay[2]) / texel) * texel;
    var cz = c[0] * Ld[0] + c[1] * Ld[1] + c[2] * Ld[2];
    var m = this.lvp;
    m[0] = ax[0] / half; m[4] = ax[1] / half; m[8] = ax[2] / half; m[12] = -cx / half;
    m[1] = ay[0] / half; m[5] = ay[1] / half; m[9] = ay[2] / half; m[13] = -cy / half;
    m[2] = -Ld[0] / depth; m[6] = -Ld[1] / depth; m[10] = -Ld[2] / depth; m[14] = cz / depth;
    m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
    this.shTexel = texel;

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo);
    gl.viewport(0, 0, S.size, S.size);
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.1, 2.0);
    var P = this.shadowProg;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uLVP, false, m);
    gl.uniform1i(P.u.uTex, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    var list = env.chunks, n = 0;
    var ex = 8 * Math.abs(ax[0]) + 8 * Math.abs(ax[2]), ey = 8 * Math.abs(ay[0]) + 8 * Math.abs(ay[2]);
    for (var i = 0; i < list.length; i++) {
      var ch = list[i], mm = ch.mesh;
      if (!mm || !mm.opaque) continue;
      var hy = (mm.topY + 2) / 2;
      var mx = ch.cx * 16 + 8, my = hy, mz = ch.cz * 16 + 8;
      var px = mx * ax[0] + my * ax[1] + mz * ax[2] - cx, py = mx * ay[0] + my * ay[1] + mz * ay[2] - cy;
      if (Math.abs(px) > half + ex + hy * Math.abs(ax[1])) continue;
      if (Math.abs(py) > half + ey + hy * Math.abs(ay[1])) continue;
      this.drawQuads(mm.opaque, mm.opaqueQuads);
      n++;
    }
    // мобы, техника и предметы тоже отбрасывают тень
    if (env.mobs && env.mobs.quads && this.mobAtlas) {
      gl.bindTexture(gl.TEXTURE_2D, this.mobAtlas);
      this.drawDynamic(env.mobs.data, env.mobs.quads);
    }
    if (env.items && env.items.quads) {
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      this.drawDynamic(env.items.data, env.items.quads);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
    gl.enableVertexAttribArray(2);
    this.stats.shadowChunks = n;
  };

  // ---- Кадр -----------------------------------------------------------------------------------------
  // env: cam, sky, fog, clouds, chunks, brightness, underwater, light, lights, grade,
  //      mobs {data, quads}, items {data, quads}, particles {data, quads},
  //      crack {x,y,z,stage}, highlight [x0,y0,z0,x1,y1,z1], held {data, quads, mob}
  Renderer.prototype.render = function (env) {
    var gl = this.gl, cam = env.cam, sky = env.sky, L = env.light || KC.Light, T = this.q.post ? this.T : null;
    var time = env.time || 0;
    this.packLights(env.lights);
    var shadows = this.shadowsOn && this.S && L.shadowK > 0.01;
    if (shadows) this.shadowPass(env);

    var target = T ? (T.msFbo || T.sceneFbo) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.w, this.h);
    gl.colorMask(true, true, true, true);
    gl.clearColor(env.fog.color[0], env.fog.color[1], env.fog.color[2], 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Небо
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    var S = this.sky;
    gl.useProgram(S.p);
    gl.uniform3fv(S.u.uFwd, this.fwd);
    gl.uniform3fv(S.u.uRight, this.right);
    gl.uniform3fv(S.u.uUp, this.up);
    gl.uniform2f(S.u.uScale, this.tanH * this.aspect, this.tanH);
    gl.uniform3fv(S.u.uTop, env.underwater ? env.fog.color : sky.top);
    gl.uniform3fv(S.u.uHor, env.underwater ? env.fog.color : sky.hor);
    gl.uniform3fv(S.u.uSun, sky.sun);
    gl.uniform3fv(S.u.uSunR, sky.sunR);
    gl.uniform3fv(S.u.uSunU, sky.sunU);
    gl.uniform3fv(S.u.uGlow, env.underwater ? [0, 0, 0] : sky.glow);
    gl.uniform1f(S.u.uNight, env.underwater ? 0 : sky.night);
    gl.uniform1f(S.u.uSunVis, env.underwater ? 0 : (sky.sunVis === undefined ? 1 : sky.sunVis));
    gl.uniform1f(S.u.uPlanet, env.underwater ? 0 : sky.planet || 0);
    gl.uniform1f(S.u.uSunK, T && T.hdr ? 3.2 : 1);
    gl.uniform1f(S.u.uTime, time);
    gl.uniform1f(S.u.uMoon, sky.moon === undefined ? 0.5 : sky.moon);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsTri);
    gl.enableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Непрозрачные и вырезанные блоки
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    var P = this.block;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp);
    gl.uniform3f(P.u.uCam, cam.x, cam.y, cam.z);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uTimeV, time);
    gl.uniform3f(P.u.uCamV, cam.x, cam.y, cam.z);
    gl.uniform3fv(P.u.uSunDirV, L.sunDir);
    gl.uniform3fv(P.u.uSunColV, L.sunCol);
    gl.uniform1f(P.u.uWind, L.wind === undefined ? 1 : L.wind);
    gl.uniform1f(P.u.uBright, env.brightness || 0);
    gl.uniform3fv(P.u.uFog, env.fog.color);
    gl.uniform3fv(P.u.uFogC, env.fog.color);
    gl.uniform3fv(P.u.uFogSun, L.fogSun || env.fog.color);
    gl.uniform2f(P.u.uFogR, env.fog.start, env.fog.end);
    gl.uniform1f(P.u.uAlpha, 1);
    gl.uniform1f(P.u.uCut, 0.5);
    gl.uniform1f(P.u.uEmit, T && T.hdr ? 1.45 : 1.1);
    gl.uniform3fv(P.u.uSunDir, L.sunDir);
    gl.uniform3fv(P.u.uSunCol, L.sunCol);
    gl.uniform3fv(P.u.uAmbTop, L.ambTop);
    gl.uniform3fv(P.u.uAmbBot, L.ambBot);
    gl.uniform3fv(P.u.uAmbCave, L.ambCave);
    gl.uniform3fv(P.u.uBlockCol, L.blockCol);
    gl.uniform1f(P.u.uSkyDep, L.skyDep === undefined ? 1 : L.skyDep);
    gl.uniform3fv(P.u.uSkyTop, sky.top);
    gl.uniform1f(P.u.uWet, env.wet || 0);
    gl.uniform3fv(P.u.uSkyHor, sky.hor);
    this.dynUniforms(P);
    if (this.shadowsOn) {
      gl.uniformMatrix4fv(P.u.uLVP, false, this.lvp);
      var tx = this.S ? 1 / this.S.size : 1;
      // при выключенном светиле карта не обновлялась: сдвигаем всё «за пределы» — работает запасной вариант
      gl.uniform4f(P.u.uShP, tx, shadows ? 0.0006 : -10, (this.shTexel || 0.05) * 1.6, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.S ? this.S.tex : null);
      gl.uniform1i(P.u.uShadow, 1);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (this.q.cloudShadows) {
      var cl = env.clouds;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.cloudSoft || null);
      gl.uniform1i(P.u.uCloudTex, 2);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform4f(P.u.uCloudP, cl ? cl.y : 200, cl ? cl.offset : 0, 12 * 64, cl && this.cloudSoft ? (cl.shadow === undefined ? 0.5 : cl.shadow) : 0);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(P.u.uTex, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);

    var visible = [], quads = 0, list = env.chunks, i;
    for (i = 0; i < list.length; i++) {
      var c = list[i], m = c.mesh;
      if (!m) continue;
      var x0 = c.cx * 16, z0 = c.cz * 16;
      if (!this.boxVisible(x0, 0, z0, x0 + 16, m.topY + 2, z0 + 16)) continue;
      var dx = x0 + 8 - cam.x, dz = z0 + 8 - cam.z;
      visible.push({ m: m, d: dx * dx + dz * dz });
    }
    visible.sort(function (a, b) { return a.d - b.d; });
    for (i = 0; i < visible.length; i++) {
      var vm = visible[i].m;
      if (vm.opaque) { this.drawQuads(vm.opaque, vm.opaqueQuads); quads += vm.opaqueQuads; }
    }

    // Мобы, предметы на земле, частицы
    var camA = [cam.x, cam.y, cam.z];
    if (env.mobs && env.mobs.quads && this.mobAtlas) {
      this.useEnt(this.mobAtlas, env, this.vp, camA);
      this.drawDynamic(env.mobs.data, env.mobs.quads);
    }
    gl.disable(gl.CULL_FACE);
    if ((env.items && env.items.quads) || (env.particles && env.particles.quads)) {
      this.useEnt(this.atlas, env, this.vp, camA);
      if (env.items && env.items.quads) this.drawDynamic(env.items.data, env.items.quads);
      if (env.particles && env.particles.quads) this.drawDynamic(env.particles.data, env.particles.quads);
    }

    // Трещины на добываемом блоке
    if (env.crack && env.crack.quads) {
      var Ec = this.useEnt(this.atlas, env, this.vp, camA);
      gl.uniform1f(Ec.u.uCut, 0.05);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      this.drawDynamic(env.crack.data, env.crack.quads);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);
    }

    // Облака
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    var volClouds = !!(T && T.atm && this.fx.atm && this.q.vclouds && env.atmos);
    if (volClouds) { /* облака рисует проход атмосферы */ }
    else if (env.clouds && this.cloudVbo && this.q.clouds3d) {
      var C3 = this.cloud3, span = 64 * CLOUD_CELL;
      gl.useProgram(C3.p);
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.uniformMatrix4fv(C3.u.uVP, false, this.vp);
      gl.uniform3f(C3.u.uCam, cam.x, cam.y, cam.z);
      gl.uniform1f(C3.u.uOff, env.clouds.offset % span);
      gl.uniform1f(C3.u.uY, env.clouds.y);
      gl.uniform1f(C3.u.uSpan, span);
      gl.uniform3fv(C3.u.uCol, env.clouds.color);
      gl.uniform3fv(C3.u.uFog, env.fog.color);
      gl.uniform1f(C3.u.uFar, Math.min(span * 0.5, env.clouds.size));
      gl.uniform3fv(C3.u.uSunDir, L.sunDir);
      gl.uniform3fv(C3.u.uSunCol, L.sunCol);
      gl.uniform1f(C3.u.uAlpha, env.clouds.alpha === undefined ? 0.8 : env.clouds.alpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVbo);
      gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 8);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
      gl.drawArrays(gl.TRIANGLES, 0, this.cloudVerts);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
    } else if (env.clouds && this.cloudTex) {
      var C = this.cloud;
      gl.useProgram(C.p);
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.uniformMatrix4fv(C.u.uVP, false, this.vp);
      gl.uniform3f(C.u.uCam, cam.x, cam.y, cam.z);
      gl.uniform1f(C.u.uSize, env.clouds.size);
      gl.uniform1f(C.u.uY, env.clouds.y);
      gl.uniform2f(C.u.uOff, env.clouds.offset, 0);
      gl.uniform1f(C.u.uCell, 12);
      gl.uniform3fv(C.u.uCol, env.clouds.color);
      gl.uniform3fv(C.u.uFog, env.fog.color);
      gl.uniform1f(C.u.uFar, env.clouds.size);
      gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
      gl.uniform1i(C.u.uTex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Вода — от дальних к ближним
    gl.useProgram(P.p);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.uniform1f(P.u.uAlpha, 0.74);
    gl.uniform1f(P.u.uCut, 0.0);
    var anyWater = false;
    for (i = 0; i < visible.length && !anyWater; i++) if (visible[i].m.water) anyWater = true;
    var waterFx = anyWater && this.fx.water && T && T.refr;
    if (waterFx) {
      // снимок цвета и глубины до воды: из него вода берёт преломление и отражения
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.refr.fbo);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, T.refr.tex);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, T.refr.dtex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(P.u.uRefr, 3); gl.uniform1i(P.u.uRefrD, 4);
      gl.uniform2f(P.u.uScreen, 1 / this.w, 1 / this.h);
      gl.uniform2f(P.u.uNF, this.near, this.far);
      gl.uniformMatrix4fv(P.u.uVPF, false, this.vp);
      // поверхность воды пишет глубину — по ней считаются дымка и затенение
      gl.depthMask(true);
    }
    for (i = visible.length - 1; i >= 0; i--) {
      var wm = visible[i].m;
      if (wm.water) { this.drawQuads(wm.water, wm.waterQuads); quads += wm.waterQuads; }
    }
    if (waterFx) gl.depthMask(false);

    // Мягкие частицы: сначала полупрозрачные (от дальних к ближним), затем светящиеся
    if (env.soft && env.soft.quads && this.partTex) {
      var PP = this.part, sq = env.soft;
      gl.useProgram(PP.p);
      gl.uniformMatrix4fv(PP.u.uVP, false, this.vp);
      gl.uniform3f(PP.u.uCamP, cam.x, cam.y, cam.z);
      gl.uniform2f(PP.u.uFogR, env.fog.start, env.fog.end);
      gl.uniform3fv(PP.u.uFogC, env.fog.color);
      gl.bindTexture(gl.TEXTURE_2D, this.partTex);
      gl.uniform1i(PP.u.uTex, 0);
      gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
      gl.bufferData(gl.ARRAY_BUFFER, sq.data, gl.DYNAMIC_DRAW);
      if (sq.addStart > 0) {
        gl.uniform1f(PP.u.uAdd, 0);
        this.drawRange9(0, sq.addStart);
      }
      if (sq.quads > sq.addStart) {
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
        gl.uniform1f(PP.u.uAdd, 1);
        this.drawRange9(sq.addStart, sq.quads - sq.addStart);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
    }

    // Рамка выделения
    if (env.highlight) {
      var h = env.highlight, e = 0.004;
      var a0 = h[0] - e, b0 = h[1] - e, c0 = h[2] - e, a1 = h[3] + e, b1 = h[4] + e, c1 = h[5] + e;
      var Lb = new Float32Array([
        a0, b0, c0, a1, b0, c0, a1, b0, c0, a1, b0, c1, a1, b0, c1, a0, b0, c1, a0, b0, c1, a0, b0, c0,
        a0, b1, c0, a1, b1, c0, a1, b1, c0, a1, b1, c1, a1, b1, c1, a0, b1, c1, a0, b1, c1, a0, b1, c0,
        a0, b0, c0, a0, b1, c0, a1, b0, c0, a1, b1, c0, a1, b0, c1, a1, b1, c1, a0, b0, c1, a0, b1, c1
      ]);
      var Ln = this.line;
      gl.useProgram(Ln.p);
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.uniformMatrix4fv(Ln.u.uVP, false, this.vp);
      gl.uniform4f(Ln.u.uColor, 0.05, 0.05, 0.05, 0.75);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, Lb, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, 24);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // Предмет в руке: поверх мира, в пространстве камеры
    if (env.held && env.held.quads) {
      // глубину мира не стираем (она нужна постобработке): рука живёт в узком слое у самой камеры
      gl.depthRange(0, 0.004);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      this.useEnt(env.held.mob ? this.mobAtlas : this.atlas, env, this.handProj, [0, 0, 0], true);
      this.drawDynamic(env.held.data, env.held.quads);
      gl.depthRange(0, 1);
    }

    if (T) this.post(env, T);

    this.stats.chunks = visible.length;
    this.stats.quads = quads;
  };

  // ---- Постобработка: сведение MSAA, свечение, тонмаппинг и цветокоррекция ------------------------
  Renderer.prototype.fullscreen = function () {
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsTri);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // Размытие буфера половинного разрешения туда-обратно (по X, затем по Y) с оглядкой на глубину
  Renderer.prototype.blurPair = function (pair, T, projU, sharp, step) {
    var gl = this.gl, Bl = this.blur;
    gl.useProgram(Bl.p);
    gl.uniform4fv(Bl.u.uProj, projU);
    gl.uniform1f(Bl.u.uSharp, sharp);
    gl.uniform1i(Bl.u.uSrc, 0);
    gl.uniform1i(Bl.u.uDepth, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, T.depthTex);
    gl.activeTexture(gl.TEXTURE0);
    for (var k = 0; k < 2; k++) {
      var src = pair[k], dst = pair[1 - k];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(Bl.u.uDir, k ? 0 : step / src.w, k ? step / src.h : 0);
      this.fullscreen();
    }
  };
  // Затенение в углах: половинное разрешение, затем размытие
  Renderer.prototype.ssaoPass = function (T, projU) {
    var gl = this.gl, S = this.ssao, a = T.ao[0], n = this.q.ssao > 1 ? 16 : 10;
    gl.useProgram(S.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.viewport(0, 0, a.w, a.h);
    gl.bindTexture(gl.TEXTURE_2D, T.depthTex);
    gl.uniform1i(S.u.uDepth, 0);
    gl.uniform4fv(S.u.uProj, projU);
    gl.uniform2f(S.u.uTexel, 1 / this.w, 1 / this.h);
    gl.uniform3fv(S.u.uKernel, this.kernel.subarray(0, n * 3));
    gl.uniform1f(S.u.uRadius, 0.85);
    this.fullscreen();
    this.blurPair(T.ao, T, projU, 6, 1.5);
  };
  // Атмосфера: объёмный свет, дымка и облака в половинном разрешении, затем размытие
  Renderer.prototype.atmosPass = function (env, T, projU) {
    var gl = this.gl, A = this.atmos, a = T.atm[0], at = env.atmos, L = env.light || KC.Light, cam = env.cam, q = this.q;
    gl.useProgram(A.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.viewport(0, 0, a.w, a.h);
    gl.bindTexture(gl.TEXTURE_2D, T.depthTex);
    gl.uniform1i(A.u.uDepth, 0);
    gl.uniform4fv(A.u.uProj, projU);
    gl.uniform3f(A.u.uCam, cam.x, cam.y, cam.z);
    gl.uniform3fv(A.u.uFwd, this.fwd);
    gl.uniform3fv(A.u.uRight, this.right);
    gl.uniform3fv(A.u.uUp, this.up);
    gl.uniform3fv(A.u.uSunDir, L.sunDir);
    gl.uniform3fv(A.u.uSunCol, at.sun);
    gl.uniform3fv(A.u.uAmbF, at.amb);
    gl.uniform4f(A.u.uFogP, at.density, at.falloff, at.base, q.vol > 1 ? 64 : q.vol ? 46 : 12);
    gl.uniform1f(A.u.uFogFar, at.far || 900);
    gl.uniform1f(A.u.uTime, env.time || 0);
    gl.uniform1f(A.u.uPhaseG, at.g === undefined ? 0.7 : at.g);
    var shOn = this.shadowsOn && this.S && L.shadowK > 0.01 && q.vol;
    gl.uniform1f(A.u.uShOn, shOn ? 1 : 0);
    if (A.u.uShadow) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, shOn ? this.S.tex : this.white);
      gl.uniform1i(A.u.uShadow, 1);
      gl.uniformMatrix4fv(A.u.uLVP, false, this.lvp);
    }
    if (A.u.uCloudTex) {
      var cl = env.clouds;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, cl && this.cloudSoft ? this.cloudSoft : this.clearAtm);
      gl.uniform1i(A.u.uCloudTex, 2);
      gl.uniform4f(A.u.uCloudP, cl ? cl.y : 1e4, cl ? cl.offset : 0, CLOUD_CELL * 64, at.cloudThick || 20);
      gl.uniform3fv(A.u.uCloudLit, at.cloudLit);
      gl.uniform3fv(A.u.uCloudAmb, at.cloudAmb);
      gl.uniform1f(A.u.uCloudFar, at.cloudFar || 1600);
      gl.uniform1f(A.u.uCloudK, at.cloudK || 0);
    }
    gl.activeTexture(gl.TEXTURE0);
    this.fullscreen();
    this.blurPair(T.atm, T, projU, 10, 1.0);
  };
  Renderer.prototype.post = function (env, T) {
    var gl = this.gl, q = this.q, w = this.w, h = this.h, G = env.grade || {};
    if (T.msFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.msFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.sceneFbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | (T.depthTex ? gl.DEPTH_BUFFER_BIT : 0), gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.enableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.activeTexture(gl.TEXTURE0);
    var fx = this.fx, projU = [this.near, this.far, this.tanH * this.aspect, this.tanH];
    var aoOn = fx.ssao && T.ao && this.ssao && !env.underwater;
    var atmOn = fx.atm && T.atm && this.atmos && env.atmos && !env.underwater;
    if (aoOn) this.ssaoPass(T, projU);
    if (atmOn) this.atmosPass(env, T, projU);
    var lv = T.levels, i;
    var bloomOn = q.bloom && lv.length > 0;
    if (bloomOn) {
      // вниз: отбор ярких пикселей и цепочка уменьшений
      var B = this.bloomPre;
      gl.useProgram(B.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lv[0].fbo);
      gl.viewport(0, 0, lv[0].w, lv[0].h);
      if (fx.atm) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, atmOn ? T.atm[0].tex : this.clearAtm);
        gl.uniform1i(B.u.uAtm, 1);
        gl.activeTexture(gl.TEXTURE0);
      }
      gl.bindTexture(gl.TEXTURE_2D, T.sceneTex);
      gl.uniform1i(B.u.uSrc, 0);
      gl.uniform2f(B.u.uTexel, 1 / w, 1 / h);
      gl.uniform2f(B.u.uThr, T.hdr ? 1.0 : 0.82, T.hdr ? 0.45 : 0.12);
      this.fullscreen();
      var D = this.bloomDown;
      gl.useProgram(D.p);
      gl.uniform1i(D.u.uSrc, 0);
      for (i = 1; i < lv.length; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, lv[i].fbo);
        gl.viewport(0, 0, lv[i].w, lv[i].h);
        gl.bindTexture(gl.TEXTURE_2D, lv[i - 1].tex);
        gl.uniform2f(D.u.uTexel, 1 / lv[i - 1].w, 1 / lv[i - 1].h);
        this.fullscreen();
      }
      // вверх: размываем «шатром» и складываем в уровень выше
      var U = this.bloomUp;
      gl.useProgram(U.p);
      gl.uniform1i(U.u.uSrc, 0);
      gl.uniform1f(U.u.uK, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (i = lv.length - 1; i > 0; i--) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, lv[i - 1].fbo);
        gl.viewport(0, 0, lv[i - 1].w, lv[i - 1].h);
        gl.bindTexture(gl.TEXTURE_2D, lv[i].tex);
        gl.uniform2f(U.u.uTexel, 1 / lv[i].w, 1 / lv[i].h);
        this.fullscreen();
      }
      gl.disable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    // итог на экран
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    var C = this.composite;
    gl.useProgram(C.p);
    gl.bindTexture(gl.TEXTURE_2D, T.sceneTex);
    gl.uniform1i(C.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomOn ? lv[0].tex : T.sceneTex);
    gl.uniform1i(C.u.uBloom, 1);
    if (fx.ssao) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, aoOn ? T.ao[0].tex : this.white);
      gl.uniform1i(C.u.uAO, 2);
      gl.uniform1f(C.u.uAOK, G.ao === undefined ? 0.75 : G.ao);
    }
    if (fx.atm) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, atmOn ? T.atm[0].tex : this.clearAtm);
      gl.uniform1i(C.u.uAtm, 3);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(C.u.uBloomK, bloomOn ? (G.bloom === undefined ? 0.22 : G.bloom) : 0);
    gl.uniform1f(C.u.uExposure, G.exposure || 1);
    gl.uniform3fv(C.u.uLift, G.lift || [0, 0, 0]);
    gl.uniform3fv(C.u.uGain, G.gain || [1, 1, 1]);
    gl.uniform1f(C.u.uSat, G.sat === undefined ? 1.08 : G.sat);
    gl.uniform1f(C.u.uContrast, G.contrast === undefined ? 1.05 : G.contrast);
    gl.uniform1f(C.u.uVignette, G.vignette === undefined ? 0.35 : G.vignette);
    gl.uniform1f(C.u.uTime, env.time || 0);
    gl.uniform1f(C.u.uWave, env.underwater ? 1 : (G.wave || 0));
    gl.uniform4fv(C.u.uTint, G.tint || [0, 0, 0, 0]);
    gl.uniform2f(C.u.uTexel, 1 / w, 1 / h);
    var sun = null;
    if (q.rays && env.sky && env.sky.sunVis !== 0 && !env.underwater) {
      var sd = env.sky.sun, cam = env.cam;
      sun = this.project(cam.x + sd[0] * 100, cam.y + sd[1] * 100, cam.z + sd[2] * 100);
    }
    var vis = 0;
    if (sun) {
      var dot = this.fwd[0] * env.sky.sun[0] + this.fwd[1] * env.sky.sun[1] + this.fwd[2] * env.sky.sun[2];
      vis = Math.max(0, Math.min(1, (dot - 0.25) / 0.5)) * (G.rays === undefined ? 0.5 : G.rays);
    }
    gl.uniform3f(C.u.uSunScr, sun ? sun[0] : 0.5, sun ? sun[1] : 0.5, vis);
    gl.uniform3fv(C.u.uRayCol, G.rayCol || [1.0, 0.9, 0.7]);
    this.fullscreen();
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.depthMask(true);
  };

  KC.Renderer = Renderer;
})(window.KC = window.KC || {});
