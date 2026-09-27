/* Кубокрафт — WebGL-рендерер: блоки, вода, небо, облака, мобы и предметы,
   частицы, трещины добычи, рамка выделения, предмет в руке.
   Работает на WebGL2 и WebGL1 (шейдеры GLSL ES 1.0). */
(function (KC) {
  'use strict';

  var FLOATS = KC.FLOATS, STRIDE = FLOATS * 4;
  var MAX_QUADS = 16384;
  var HP = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

  // Блоки: свет = тень × max(небо × день, тёплый свет факелов, минимум)
  var BLOCK_VS = [
    'attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aLight;',
    'uniform mat4 uVP; uniform vec3 uCam; uniform float uDay; uniform float uBright;',
    'varying vec2 vUV; varying vec3 vLight; varying float vDist;',
    'void main() {',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '  vUV = aUV;',
    '  vec3 L = max(vec3(aLight.y * uDay), aLight.z * vec3(1.0, 0.86, 0.66));',
    '  L = max(L, vec3(0.07));',
    '  L = mix(L, sqrt(L), uBright);',
    '  vLight = aLight.x * L;',
    '  vDist = length(aPos.xz - uCam.xz);',
    '}'
  ].join('\n');

  var BLOCK_FS = HP + [
    'uniform sampler2D uTex; uniform vec3 uFog; uniform vec2 uFogR; uniform float uAlpha; uniform float uCut;',
    'varying vec2 vUV; varying vec3 vLight; varying float vDist;',
    'void main() {',
    '  vec4 c = texture2D(uTex, vUV);',
    '  if (c.a < uCut) discard;',
    '  float f = clamp((vDist - uFogR.x) / (uFogR.y - uFogR.x), 0.0, 1.0);',
    '  gl_FragColor = vec4(mix(c.rgb * vLight, uFog, f), c.a * uAlpha);',
    '}'
  ].join('\n');

  // Сущности, частицы, предмет в руке: цвет вершины уже содержит свет и оттенок
  var ENT_VS = [
    'attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aCol;',
    'uniform mat4 uVP; uniform vec3 uCam;',
    'varying vec2 vUV; varying vec3 vCol; varying float vDist;',
    'void main() {',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '  vUV = aUV; vCol = aCol;',
    '  vDist = length(aPos.xz - uCam.xz);',
    '}'
  ].join('\n');

  var ENT_FS = HP + [
    'uniform sampler2D uTex; uniform vec3 uFog; uniform vec2 uFogR; uniform float uAlpha; uniform float uCut;',
    'varying vec2 vUV; varying vec3 vCol; varying float vDist;',
    'void main() {',
    '  vec4 c = texture2D(uTex, vUV);',
    '  if (c.a < uCut) discard;',
    '  float f = clamp((vDist - uFogR.x) / (uFogR.y - uFogR.x), 0.0, 1.0);',
    '  gl_FragColor = vec4(mix(c.rgb * vCol, uFog, f), c.a * uAlpha);',
    '}'
  ].join('\n');

  var SKY_VS = 'attribute vec2 aPos; varying vec2 vP; void main() { vP = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }';
  var SKY_FS = HP + [
    'uniform vec3 uFwd; uniform vec3 uRight; uniform vec3 uUp; uniform vec2 uScale;',
    'uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunR; uniform vec3 uSunU;',
    'uniform vec3 uGlow; uniform float uNight; uniform float uSunVis; uniform float uPlanet;',
    'varying vec2 vP;',
    'float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }',
    'void main() {',
    '  vec3 d = normalize(uFwd + vP.x * uScale.x * uRight + vP.y * uScale.y * uUp);',
    '  float t = clamp(d.y, 0.0, 1.0);',
    '  vec3 col = mix(uHor, uTop, pow(t, 0.6));',
    '  if (d.y < 0.0) col = mix(uHor, uHor * 0.8, clamp(-d.y * 4.0, 0.0, 1.0));',
    '  float sd = dot(d, uSun);',
    '  col += uGlow * pow(max(sd, 0.0), 8.0) * (1.0 - t * 0.7);',
    '  if (uNight > 0.01 && (d.y > 0.0 || uPlanet > 0.5)) {',
    '    float h = hash(floor(d * 220.0));',
    '    if (h > 0.9972) col += vec3(0.9, 0.92, 1.0) * uNight * (h - 0.9972) * 357.0 * max(t, uPlanet);',
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
    '        col = base * lit + vec3(0.25, 0.45, 1.0) * pow(1.0 - sqrt(1.0 - r2), 3.0) * 0.7;',
    '      } else if (r2 < 1.12) col += vec3(0.25, 0.45, 1.0) * (1.12 - r2) * 2.2;',
    '    }',
    '  }',
    '  if (uSunVis < 0.5) { gl_FragColor = vec4(col, 1.0); return; }',
    '  if (sd > 0.0 && d.y > -0.01) {',
    '    vec2 q = vec2(dot(d, uSunR), dot(d, uSunU)) / sd;',
    '    float m = max(abs(q.x), abs(q.y));',
    '    col += vec3(1.0, 0.75, 0.45) * (1.0 - smoothstep(0.07, 0.32, m)) * 0.18;',
    '    if (m < 0.075) col = vec3(1.0, 0.96, 0.78);',
    '  } else if (sd < 0.0 && d.y > -0.01) {',
    '    vec2 q = vec2(dot(d, uSunR), dot(d, uSunU)) / -sd;',
    '    float m = max(abs(q.x), abs(q.y));',
    '    if (m < 0.055) {',
    '      float spot = step(0.6, fract(sin(dot(floor(q * 60.0), vec2(7.1, 3.7))) * 91.3));',
    '      col = mix(vec3(0.86, 0.88, 0.94), vec3(0.7, 0.72, 0.8), spot * 0.6);',
    '    }',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
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
  var CLOUD_FS = HP + [
    'uniform sampler2D uTex; uniform vec2 uOff; uniform float uCell; uniform vec3 uCol; uniform vec3 uFog; uniform float uFar;',
    'varying vec2 vW; varying float vDist;',
    'void main() {',
    '  vec2 uv = (vW + uOff) / (uCell * 64.0);',
    '  if (texture2D(uTex, uv).a < 0.5) discard;',
    '  float f = clamp(vDist / uFar, 0.0, 1.0); f *= f;',
    '  gl_FragColor = vec4(mix(uCol, uFog, f), 0.82 * (1.0 - f));',
    '}'
  ].join('\n');

  var LINE_VS = 'attribute vec3 aPos; uniform mat4 uVP; void main() { gl_Position = uVP * vec4(aPos, 1.0); }';
  var LINE_FS = 'precision mediump float; uniform vec4 uColor; void main() { gl_FragColor = uColor; }';

  function Renderer(canvas) {
    var opts = { antialias: false, alpha: false, depth: true, powerPreference: 'high-performance' };
    var gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('no-webgl');
    this.gl = gl;
    this.canvas = canvas;

    this.block = this.program(BLOCK_VS, BLOCK_FS, ['aPos', 'aUV', 'aLight'],
      ['uVP', 'uCam', 'uDay', 'uBright', 'uTex', 'uFog', 'uFogR', 'uAlpha', 'uCut']);
    this.ent = this.program(ENT_VS, ENT_FS, ['aPos', 'aUV', 'aCol'],
      ['uVP', 'uCam', 'uTex', 'uFog', 'uFogR', 'uAlpha', 'uCut']);
    this.sky = this.program(SKY_VS, SKY_FS, ['aPos'],
      ['uFwd', 'uRight', 'uUp', 'uScale', 'uTop', 'uHor', 'uSun', 'uSunR', 'uSunU', 'uGlow', 'uNight', 'uSunVis', 'uPlanet']);
    this.cloud = this.program(CLOUD_VS, CLOUD_FS, ['aPos'],
      ['uVP', 'uCam', 'uSize', 'uY', 'uTex', 'uOff', 'uCell', 'uCol', 'uFog', 'uFar']);
    this.line = this.program(LINE_VS, LINE_FS, ['aPos'], ['uVP', 'uColor']);

    var idx = new Uint16Array(MAX_QUADS * 6);
    for (var q = 0; q < MAX_QUADS; q++) {
      var v = q * 4, o = q * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    this.fsTri = this.staticBuffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
    this.quad = this.staticBuffer(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    this.lineBuf = gl.createBuffer();
    this.dynBuf = gl.createBuffer();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.vp = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.handProj = new Float32Array(16);
    this.view = new Float32Array(16);
    this.planes = new Float32Array(24);
    this.stats = { chunks: 0, quads: 0 };
  }

  Renderer.prototype.program = function (vs, fs, attrs, unis) {
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
    var u = {};
    unis.forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    return { p: p, u: u };
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

  Renderer.prototype.setAtlas = function (canvas) { this.atlas = this.texture(canvas, false); };
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
      img.data[i * 4 + 3] = g[i] > 0.535 ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
    if (this.cloudTex) this.gl.deleteTexture(this.cloudTex);
    this.cloudTex = this.texture(cv, true);
  };

  Renderer.prototype.resize = function (w, h) {
    this.canvas.width = w; this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
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

  Renderer.prototype.boxVisible = function (x0, y0, z0, x1, y1, z1) {
    var pl = this.planes;
    for (var i = 0; i < 6; i++) {
      var k = i * 4, a = pl[k], b = pl[k + 1], c = pl[k + 2], d = pl[k + 3];
      if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? y1 : y0) + c * (c > 0 ? z1 : z0) + d < 0) return false;
    }
    return true;
  };

  Renderer.prototype.useEnt = function (tex, env, vp, cam, noFog) {
    var gl = this.gl, E = this.ent;
    gl.useProgram(E.p);
    gl.uniformMatrix4fv(E.u.uVP, false, vp);
    gl.uniform3f(E.u.uCam, cam[0], cam[1], cam[2]);
    gl.uniform3fv(E.u.uFog, env.fog.color);
    if (noFog) gl.uniform2f(E.u.uFogR, 1000, 2000);
    else gl.uniform2f(E.u.uFogR, env.fog.start, env.fog.end);
    gl.uniform1f(E.u.uAlpha, 1);
    gl.uniform1f(E.u.uCut, 0.5);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(E.u.uTex, 0);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    return E;
  };

  // env: cam, sky, fog, clouds, chunks, brightness, underwater,
  //      mobs {data, quads}, items {data, quads}, particles {data, quads},
  //      crack {x,y,z,stage}, highlight [x0,y0,z0,x1,y1,z1], held {data, quads, mob}
  Renderer.prototype.render = function (env) {
    var gl = this.gl, cam = env.cam, sky = env.sky;
    gl.clearColor(env.fog.color[0], env.fog.color[1], env.fog.color[2], 1);
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
    gl.uniform1f(S.u.uSunVis, sky.sunVis === undefined ? 1 : sky.sunVis);
    gl.uniform1f(S.u.uPlanet, env.underwater ? 0 : sky.planet || 0);
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
    gl.uniform1f(P.u.uDay, sky.day);
    gl.uniform1f(P.u.uBright, env.brightness || 0);
    gl.uniform3fv(P.u.uFog, env.fog.color);
    gl.uniform2f(P.u.uFogR, env.fog.start, env.fog.end);
    gl.uniform1f(P.u.uAlpha, 1);
    gl.uniform1f(P.u.uCut, 0.5);
    gl.activeTexture(gl.TEXTURE0);
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
    if (env.clouds && this.cloudTex) {
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
    for (i = visible.length - 1; i >= 0; i--) {
      var wm = visible[i].m;
      if (wm.water) { this.drawQuads(wm.water, wm.waterQuads); quads += wm.waterQuads; }
    }

    // Рамка выделения
    if (env.highlight) {
      var h = env.highlight, e = 0.004;
      var a0 = h[0] - e, b0 = h[1] - e, c0 = h[2] - e, a1 = h[3] + e, b1 = h[4] + e, c1 = h[5] + e;
      var L = new Float32Array([
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
      gl.bufferData(gl.ARRAY_BUFFER, L, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, 24);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // Предмет в руке: поверх мира, в пространстве камеры
    if (env.held && env.held.quads) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      this.useEnt(env.held.mob ? this.mobAtlas : this.atlas, env, this.handProj, [0, 0, 0], true);
      this.drawDynamic(env.held.data, env.held.quads);
    }

    this.stats.chunks = visible.length;
    this.stats.quads = quads;
  };

  KC.Renderer = Renderer;
})(window.KC = window.KC || {});
