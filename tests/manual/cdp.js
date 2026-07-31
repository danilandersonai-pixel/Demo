// Минимальный клиент Chrome DevTools Protocol: запускает Chromium, даёт
// evaluate и screenshot. Нужен ручному аудиту интерфейса (tests/manual).
//
// Почему не штатный `chrome --screenshot`: он зависает на нашей панели,
// потому что SSE держит соединение открытым и «загрузка страницы» не
// завершается никогда. Здесь кадр снимается тогда, когда мы решим.
//
// Своя реализация WebSocket (~60 строк) вместо зависимости: у Штурмана
// принцип «ноль зависимостей», и ради инструмента разработчика его нарушать
// не стоит.
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ws(url) {
  const u = new URL(url);
  const key = crypto.randomBytes(16).toString('base64');
  const sock = net.connect(Number(u.port), u.hostname);
  const handlers = new Map();
  let id = 0, buf = Buffer.alloc(0), shook = false, ready;
  const readyP = new Promise((r) => { ready = r; });

  sock.on('connect', () => sock.write(
    `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\n` +
    `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));

  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!shook) {
      const i = buf.indexOf('\r\n\r\n');
      if (i === -1) return;
      buf = buf.slice(i + 4); shook = true; ready();
    }
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const payload = buf.slice(off, off + len);
      buf = buf.slice(off + len);
      if (op !== 1) continue;
      let m; try { m = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
      if (m.id && handlers.has(m.id)) { handlers.get(m.id)(m); handlers.delete(m.id); }
    }
  });

  function frame(text) {
    const d = Buffer.from(text, 'utf8');
    const mask = crypto.randomBytes(4);
    let h;
    if (d.length < 126) h = Buffer.from([0x81, 0x80 | d.length]);
    else if (d.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xfe; h.writeUInt16BE(d.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0xff; h.writeBigUInt64BE(BigInt(d.length), 2); }
    const m = Buffer.alloc(d.length);
    for (let i = 0; i < d.length; i++) m[i] = d[i] ^ mask[i % 4];
    return Buffer.concat([h, mask, m]);
  }

  return {
    ready: readyP,
    send(method, params) {
      id++; const mine = id;
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('CDP timeout: ' + method)), 30000);
        handlers.set(mine, (m) => {
          clearTimeout(t);
          m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result);
        });
        sock.write(frame(JSON.stringify({ id: mine, method, params: params || {} })));
      });
    },
    close() { try { sock.destroy(); } catch (e) {} }
  };
}

async function launch(opts = {}) {
  const port = opts.cdpPort || (9400 + Math.floor(process.pid % 100));
  const profile = opts.profile || '/tmp/cdp-profile-' + port;
  fs.rmSync(profile, { recursive: true, force: true });
  const env = { ...process.env };
  ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].forEach((k) => delete env[k]);

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-dev-shm-usage', '--no-proxy-server', '--no-first-run',
    '--disable-background-networking', '--disable-component-update',
    '--user-data-dir=' + profile,
    '--window-size=' + (opts.width || 1500) + ',' + (opts.height || 980),
    '--remote-debugging-port=' + port, 'about:blank'
  ], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  spawned.push(chrome);

  let list = null;
  for (let i = 0; i < 80; i++) {
    try {
      list = await new Promise((res, rej) => {
        http.get({ host: '127.0.0.1', port, path: '/json/list' }, (r) => {
          let b = ''; r.on('data', (c) => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
        }).on('error', rej);
      });
      break;
    } catch (e) { await sleep(250); }
  }
  if (!list) throw new Error('Chrome не поднял отладочный порт');

  const page = list.find((t) => t.type === 'page') || list[0];
  const c = ws(page.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Log.enable').catch(() => {});

  const errors = [];
  return {
    errors,
    async metrics(w, h, mobile) {
      await c.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile,
        screenWidth: w, screenHeight: h
      });
      if (mobile) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    },
    async goto(url, settle = 3500) {
      await c.send('Page.navigate', { url });
      await sleep(settle);
    },
    async eval(expr) {
      const r = await c.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true
      });
      if (r.exceptionDetails) {
        throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      }
      return r.result.value;
    },
    async json(expr) { return JSON.parse(await this.eval(`JSON.stringify(${expr})`)); },
    async shot(file) {
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },
    async close() { c.close(); chrome.kill(); },
    sleep
  };
}

// Аварийное завершение всех запущенных нами браузеров.
const spawned = [];
function killAll() {
  while (spawned.length) {
    const p = spawned.pop();
    try { p.kill(); } catch (e) { /* уже мёртв */ }
  }
}

module.exports = { launch, sleep, killAll };
