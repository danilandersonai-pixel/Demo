/* Кубокрафт — WebGL-рендерер: блоки, вода, небо, облака, частицы, рамка выделения.
   Работает и на WebGL2, и на WebGL1 (шейдеры GLSL ES 1.0). */
(function (KC) {
  'use strict';

  var FLOATS = KC.FLOATS, STRIDE = FLOATS * 4;
  var MAX_QUADS = 16384; // 65536 вершин на один вызов отрисовки (16-битные индексы)

  var HP = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

  var BLOCK_VS = [
    'attribute vec3 aPos; attribute vec2 aUV; attribute vec2 aLight;',
    'uniform mat4 uVP; uniform vec3 uCam; uniform float uDay;',
    'varying vec2 vUV; varying float vLight; varying float vDist;',
    'void main() {',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '  vUV = aUV;',
    '  vLight = aLight.x * (0.2 + 0.8 * aLight.y * uDay);',
    '  vDist = length(aPos.xz - uCam.xz);',
    '}'
  ].join('\n');

  var BLOCK_FS = HP + [
    'uniform sampler2D uTex; uniform vec3 uFog; uniform vec2 uFogR; uniform float uAlpha; uniform float uCut;',
    'varying vec2 vUV; varying float vLight; varying float vDist;',
    'void main() {',
    '  vec4 c = texture2D(uTex, vUV);',
    '  if (c.a < uCut) discard;',
    '  float f = clamp((vDist - uFogR.x) / (uFogR.y - uFogR.x), 0.0, 1.0);',
    '  gl_FragColor = vec4(mix(c.rgb * vLight, uFog, f), c.a * uAlpha);',
    '}'
  ].join('\n');

  var SKY_VS = [
    'attribute vec2 aPos; varying vec2 vP;',
    'void main() { vP = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var SKY_FS = HP + [
    'uniform vec3 uFwd; uniform vec3 uRight; uniform vec3 uUp; uniform vec2 uScale;',
    'uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunR; uniform vec3 uSunU;',
    'uniform vec3 uGlow; uniform float uNight;',
    'varying vec2 vP;',
    'float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }',
    'void main() {',
    '  vec3 d = normalize(uFwd + vP.x * uScale.x * uRight + vP.y * uScale.y * uUp);',
    '  float t = clamp(d.y, 0.0, 1.0);',
    '  vec3 col = mix(uHor, uTop, pow(t, 0.6));',
    '  if (d.y < 0.0) col = mix(uHor, uHor * 0.8, clamp(-d.y * 4.0, 0.0, 1.0));',
    '  float sd = dot(d, uSun);',
    '  col += uGlow * pow(max(sd, 0.0), 8.0) * (1.0 - t * 0.7);',
    '  if (uNight > 0.01 && d.y > 0.0) {',
    '    float h = hash(floor(d * 220.0));',
    '    if (h > 0.9972) col += vec3(0.9, 0.92, 1.0) * uNight * (h - 0.9972) * 357.0 * t;',
    '  }',
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
    var opts = { antialias: false, alpha: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false };
    var gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('no-webgl');
    this.gl = gl;
    this.canvas = canvas;

    this.block = this.program(BLOCK_VS, BLOCK_FS, ['aPos', 'aUV', 'aLight'],
      ['uVP', 'uCam', 'uDay', 'uTex', 'uFog', 'uFogR', 'uAlpha', 'uCut']);
    this.sky = this.program(SKY_VS, SKY_FS, ['aPos'],
      ['uFwd', 'uRight', 'uUp', 'uScale', 'uTop', 'uHor', 'uSun', 'uSunR', 'uSunU', 'uGlow', 'uNight']);
    this.cloud = this.program(CLOUD_VS, CLOUD_FS, ['aPos'],
      ['uVP', 'uCam', 'uSize', 'uY', 'uTex', 'uOff', 'uCell', 'uCol', 'uFog', 'uFar']);
    this.line = this.program(LINE_VS, LINE_FS, ['aPos'], ['uVP', 'uColor']);

    // Общий индекс-буфер для квадов: 0 1 2, 0 2 3
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
    this.partBuf = gl.createBuffer();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.vp = new Float32Array(16);
    this.proj = new Float32Array(16);
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
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error('shader: ' + gl.getShaderInfoLog(s));
      }
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    attrs.forEach(function (a, i) { gl.bindAttribLocation(p, i, a); });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
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

  // Облака: 64×64 клетки, пятна из сглаженного шума с «заворотом» краёв
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
      var on = g[i] > 0.535;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = on ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
    if (this.cloudTex) this.gl.deleteTexture(this.cloudTex);
    this.cloudTex = this.texture(cv, true);
  };

  Renderer.prototype.resize = function (w, h) {
    this.canvas.width = w; this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  };

  // ---- Меши чанков ------------------------------------------------------------
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
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, base + 20);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    }
  };

  // ---- Камера -------------------------------------------------------------------
  Renderer.prototype.setCamera = function (cam, fov, aspect, far) {
    var p = this.proj, f = 1 / Math.tan(fov / 2), near = 0.08;
    p.fill(0);
    p[0] = f / aspect; p[5] = f; p[10] = (far + near) / (near - far); p[11] = -1; p[14] = 2 * far * near / (near - far);

    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    // Строки матрицы вида = Rx(-pitch)·Ry(-yaw)
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
    mul4(this.vp, p, v);

    // Базис камеры для неба, частиц и луча
    this.fwd = [-sy * cp, sp, -cy * cp];
    this.right = [cy, 0, -sy];
    this.up = [sy * sp, cp, cy * sp];
    this.tanH = Math.tan(fov / 2);
    this.aspect = aspect;
    this.far = far;

    // Плоскости пирамиды видимости (Gribb–Hartmann)
    var m = this.vp, pl = this.planes;
    for (var i = 0; i < 3; i++) {
      for (var s = 0; s < 2; s++) {
        var k = (i * 2 + s) * 4, sign = s ? -1 : 1;
        pl[k] = m[3] + sign * m[i];
        pl[k + 1] = m[7] + sign * m[4 + i];
        pl[k + 2] = m[11] + sign * m[8 + i];
        pl[k + 3] = m[15] + sign * m[12 + i];
      }
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

  // ---- Кадр -------------------------------------------------------------------
  // env: { cam, sky:{top,hor,glow,sun,night,day}, fog:{color,start,end}, clouds, time,
  //        chunks: итерируемый список, highlight, particles:{data,quads}, underwater }
  Renderer.prototype.render = function (env) {
    var gl = this.gl, cam = env.cam, sky = env.sky;
    gl.clearColor(env.fog.color[0], env.fog.color[1], env.fog.color[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Небо: полноэкранный треугольник без записи глубины
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsTri);
    gl.enableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Непрозрачные блоки + вырезанные (листва, стекло, растения)
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    var P = this.block;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp);
    gl.uniform3f(P.u.uCam, cam.x, cam.y, cam.z);
    gl.uniform1f(P.u.uDay, sky.day);
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

    var visible = [], quads = 0;
    var list = env.chunks;
    for (var i = 0; i < list.length; i++) {
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

    // Частицы от разбитых блоков
    if (env.particles && env.particles.quads) {
      gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      gl.bufferData(gl.ARRAY_BUFFER, env.particles.data, gl.DYNAMIC_DRAW);
      this.drawQuads(this.partBuf, env.particles.quads);
    }

    // Облака
    gl.disable(gl.CULL_FACE);
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
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    }

    // Вода — от дальних чанков к ближним
    gl.useProgram(P.p);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.uniform1f(P.u.uAlpha, 0.74);
    gl.uniform1f(P.u.uCut, 0.0);
    for (i = visible.length - 1; i >= 0; i--) {
      var wm = visible[i].m;
      if (wm.water) { this.drawQuads(wm.water, wm.waterQuads); quads += wm.waterQuads; }
    }

    // Рамка вокруг выбранного блока
    if (env.highlight) {
      var h = env.highlight, e = 0.004;
      var a0 = h.x - e, b0 = h.y - e, c0 = h.z - e, a1 = h.x + 1 + e, b1 = h.y + 1 + e, c1 = h.z + 1 + e;
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
    this.stats.chunks = visible.length;
    this.stats.quads = quads;
  };

  KC.Renderer = Renderer;
})(window.KC = window.KC || {});
