// WebGL renderer: terrain/water shading, texture atlas, block-selection wireframe.

import { buildAtlas } from './textures.js';

const TERRAIN_VS = `
attribute vec3 aPos;
attribute vec2 aUV;
attribute float aLight;
uniform mat4 uViewProj;
uniform vec3 uChunkPos;
uniform vec3 uCam;
varying vec2 vUV;
varying float vLight;
varying float vDist;
void main() {
  vec3 world = aPos + uChunkPos;
  vUV = aUV;
  vLight = aLight;
  vDist = length(world - uCam);
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const TERRAIN_FS = `
precision mediump float;
varying vec2 vUV;
varying float vLight;
varying float vDist;
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlpha;
void main() {
  vec4 tex = texture2D(uTex, vUV);
  vec3 col = tex.rgb * vLight;
  float fog = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, uAlpha);
}`;

const LINE_VS = `
attribute vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uBlock;
void main() {
  vec3 p = (aPos - 0.5) * 1.004 + 0.5 + uBlock;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const LINE_FS = `
precision mediump float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

const STRIDE = 6 * 4; // bytes per vertex

export class Renderer {
  constructor(canvas) {
    const opts = { antialias: true, alpha: false, powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL is not supported by this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.fog = [0.62, 0.76, 0.92];

    this.terrain = program(gl, TERRAIN_VS, TERRAIN_FS);
    this.tLoc = {
      aPos: gl.getAttribLocation(this.terrain, 'aPos'),
      aUV: gl.getAttribLocation(this.terrain, 'aUV'),
      aLight: gl.getAttribLocation(this.terrain, 'aLight'),
      uViewProj: gl.getUniformLocation(this.terrain, 'uViewProj'),
      uChunkPos: gl.getUniformLocation(this.terrain, 'uChunkPos'),
      uCam: gl.getUniformLocation(this.terrain, 'uCam'),
      uTex: gl.getUniformLocation(this.terrain, 'uTex'),
      uFogColor: gl.getUniformLocation(this.terrain, 'uFogColor'),
      uFogNear: gl.getUniformLocation(this.terrain, 'uFogNear'),
      uFogFar: gl.getUniformLocation(this.terrain, 'uFogFar'),
      uAlpha: gl.getUniformLocation(this.terrain, 'uAlpha'),
    };

    this.line = program(gl, LINE_VS, LINE_FS);
    this.lLoc = {
      aPos: gl.getAttribLocation(this.line, 'aPos'),
      uViewProj: gl.getUniformLocation(this.line, 'uViewProj'),
      uBlock: gl.getUniformLocation(this.line, 'uBlock'),
      uColor: gl.getUniformLocation(this.line, 'uColor'),
    };
    this.lineBuf = this._makeLineCube();

    this.texture = this._makeTexture(buildAtlas());

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(this.fog[0], this.fog[1], this.fog[2], 1.0);
  }

  _makeTexture(source) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  _makeLineCube() {
    const gl = this.gl;
    const e = [
      [0, 0, 0], [1, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 0], [0, 1, 0], [0, 1, 0], [0, 0, 0],
      [0, 0, 1], [1, 0, 1], [1, 0, 1], [1, 1, 1], [1, 1, 1], [0, 1, 1], [0, 1, 1], [0, 0, 1],
      [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1], [0, 1, 0], [0, 1, 1],
    ];
    const arr = new Float32Array(e.flat());
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    return { buffer: buf, count: e.length };
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    return this.canvas.width / Math.max(1, this.canvas.height);
  }

  // meshData: { opaque: Float32Array, water: Float32Array }
  uploadChunk(chunk, meshData) {
    const gl = this.gl;
    chunk.glOpaque = this._upload(chunk.glOpaque, meshData.opaque);
    chunk.glWater = this._upload(chunk.glWater, meshData.water);
  }

  _upload(existing, data) {
    const gl = this.gl;
    if (data.length === 0) {
      if (existing) gl.deleteBuffer(existing.buffer);
      return null;
    }
    let buf = existing ? existing.buffer : gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return { buffer: buf, count: data.length / 6 };
  }

  freeChunk(chunk) {
    const gl = this.gl;
    if (chunk.glOpaque) { gl.deleteBuffer(chunk.glOpaque.buffer); chunk.glOpaque = null; }
    if (chunk.glWater) { gl.deleteBuffer(chunk.glWater.buffer); chunk.glWater = null; }
  }

  beginFrame() {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }

  // Render every chunk. `chunks` is an iterable of Chunk.
  renderChunks(chunks, viewProj, camPos, fogNear, fogFar) {
    const gl = this.gl;
    gl.useProgram(this.terrain);
    gl.uniformMatrix4fv(this.tLoc.uViewProj, false, viewProj);
    gl.uniform3fv(this.tLoc.uCam, camPos);
    gl.uniform3fv(this.tLoc.uFogColor, this.fog);
    gl.uniform1f(this.tLoc.uFogNear, fogNear);
    gl.uniform1f(this.tLoc.uFogFar, fogFar);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.tLoc.uTex, 0);

    const L = this.tLoc;
    gl.enableVertexAttribArray(L.aPos);
    gl.enableVertexAttribArray(L.aUV);
    gl.enableVertexAttribArray(L.aLight);

    // Opaque pass.
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.uniform1f(L.uAlpha, 1.0);
    for (const c of chunks) {
      if (!c.glOpaque) continue;
      gl.uniform3f(L.uChunkPos, c.cx * 16, 0, c.cz * 16);
      this._bindAndDraw(c.glOpaque);
    }

    // Water pass (translucent, no depth write).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(L.uAlpha, 0.72);
    for (const c of chunks) {
      if (!c.glWater) continue;
      gl.uniform3f(L.uChunkPos, c.cx * 16, 0, c.cz * 16);
      this._bindAndDraw(c.glWater);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _bindAndDraw(mesh) {
    const gl = this.gl;
    const L = this.tLoc;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribPointer(L.aUV, 2, gl.FLOAT, false, STRIDE, 12);
    gl.vertexAttribPointer(L.aLight, 1, gl.FLOAT, false, STRIDE, 20);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  drawSelection(viewProj, block) {
    const gl = this.gl;
    gl.useProgram(this.line);
    gl.uniformMatrix4fv(this.lLoc.uViewProj, false, viewProj);
    gl.uniform3f(this.lLoc.uBlock, block[0], block[1], block[2]);
    gl.uniform4f(this.lLoc.uColor, 0.05, 0.05, 0.05, 0.9);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf.buffer);
    gl.enableVertexAttribArray(this.lLoc.aPos);
    gl.vertexAttribPointer(this.lLoc.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, this.lineBuf.count);
  }
}
