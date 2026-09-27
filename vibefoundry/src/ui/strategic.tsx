import { useEffect, useRef, useState } from 'preact/hooks';
import type { Game } from '../game';
import { BIOMES, isWater } from '../data/biomes';
import { RESOURCE_NAMES } from '../data/items';
import { Rng } from '../core/rng';
import { Icon } from './icons';
import { ItemImg } from './hud';

const LAYERS: [string, string, string][] = [
  ['forest', 'Лес', '#2d621b'],
  ['mountains', 'Горы', '#81817e'],
  ['desert', 'Пустыня', '#c08a48'],
  ['tundra', 'Тундра', '#7d9270'],
  ['swamp', 'Болото', '#486452'],
  ['water', 'Вода', '#0f5a78'],
  ['plains', 'Равнины', '#8a9a3a'],
  ['danger', 'Красная зона', '#8a3322'],
];

function hex(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

export function StrategicMap({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [geo, setGeo] = useState<{ s: number; ox: number; oy: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const layers = game.ui.mapLayers;
  const layerKey = Object.values(layers).join(',');
  const sim = game.sim;
  const w = sim.world;

  useEffect(() => {
    const cv = ref.current!;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const N = w.w;
    const s = Math.min((W * 0.92) / (2 * N), (H * 0.9) / N);
    const ox = W / 2;
    const oy = (H - N * s) / 2;
    // ocean
    const grd = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, Math.max(W, H) * 0.7);
    grd.addColorStop(0, '#064463');
    grd.addColorStop(1, '#021a2a');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
    // terrain via an ImageData in tile space, then drawn with the iso transform
    const img = new ImageData(N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const b = w.biome[i];
        const def = BIOMES[b];
        let [r, g, bl] = hex(def.map);
        if (!layers[def.legend]) {
          const m = (r + g + bl) / 3;
          r = g = bl = m * 0.55;
        }
        // hill shading from the height field (light from north-west)
        const h0 = w.height[i];
        const hx = w.height[y * N + Math.min(N - 1, x + 1)];
        const hy = w.height[Math.min(N - 1, y + 1) * N + x];
        const shade = isWater(b) ? 1 : 1 + ((h0 - hx) + (h0 - hy)) * 0.012;
        let k = Math.max(0.55, Math.min(1.35, shade));
        if (!w.fog[i]) k *= 0.42;
        if (w.res[i] && w.amt[i] > 0 && w.fog[i]) {
          r = r * 0.6 + 176 * 0.4;
          g = g * 0.6 + 154 * 0.4;
          bl = bl * 0.6 + 128 * 0.4;
        }
        const o = i * 4;
        d[o] = Math.min(255, r * k);
        d[o + 1] = Math.min(255, g * k);
        d[o + 2] = Math.min(255, bl * k);
        d[o + 3] = b === 0 ? 0 : 255;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = N;
    tmp.height = N;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.save();
    ctx.setTransform(dpr * s, (dpr * s) / 2, -dpr * s, (dpr * s) / 2, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    // clouds around the edges
    const rng = new Rng(w.seed ^ 77);
    for (let k = 0; k < 90; k++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = rng.range(0.42, 0.62);
      const cx = W / 2 + Math.cos(a) * W * rr;
      const cy = H / 2 + Math.sin(a) * H * rr * 0.95;
      const rad = rng.range(40, 120);
      const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g2.addColorStop(0, `rgba(210,225,235,${rng.range(0.18, 0.35)})`);
      g2.addColorStop(1, 'rgba(210,225,235,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    setGeo({ s, ox, oy });
  }, [sim, layerKey]);

  const P = (x: number, y: number) => (geo ? { left: geo.ox + (x - y) * geo.s, top: geo.oy + ((x + y) * geo.s) / 2 } : { left: 0, top: 0 });
  const toTile = (px: number, py: number) => {
    if (!geo) return null;
    const a = (px - geo.ox) / geo.s;
    const b = ((py - geo.oy) / geo.s) * 2;
    return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) };
  };
  const onMove = (ev: MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const t = toTile(ev.clientX - r.left, ev.clientY - r.top);
    if (t && w.inBounds(t.x, t.y)) {
      setHover(t);
      game.ui.focusTile = t;
    }
  };
  const onClick = () => {
    if (!hover) return;
    game.ui.panel = null;
    game.focusTile(hover.x, hover.y, 1.1);
  };
  // deposit markers: one per deposit record, revealed only
  const deposits = w.deposits.filter((dp) => w.isRevealed(dp.x, dp.y));
  const hiddenDeposits = w.deposits.filter((dp) => !w.isRevealed(dp.x, dp.y));
  const toggle = (k: string) => {
    layers[k] = !layers[k];
    game.emit();
  };
  const hq = sim.hq!;
  return (
    <div class="stratmap">
      <div class="smwrap" onMouseMove={onMove} onClick={onClick}>
        <canvas ref={ref} />
        {geo && (
          <div class="markers">
            <div class="mk base" style={P(hq.x + 2.5, hq.y + 2.5)}><span class="mi" style={{ background: '#0a4a7a', borderColor: '#32c6f4' }}><Icon name="home" size={16} /></span><span class="ml">База</span></div>
            {deposits.map((dp, i) => (
              <div class="mk" key={i} style={P(dp.x, dp.y)}><span class="mi"><ItemImg id={dp.res} size={16} /></span><span class="ml">{RESOURCE_NAMES[dp.res]}</span></div>
            ))}
            {hiddenDeposits.slice(0, 12).map((dp, i) => (
              <div class="mk small" key={'h' + i} style={P(dp.x, dp.y)} data-tip="Месторождение (не разведано)"><span class="mi dim"><Icon name="mountain" size={12} /></span></div>
            ))}
            {w.pois.map((p) => (
              <div class="mk" key={'p' + p.id} style={P(p.x, p.y)} data-tip={p.explored ? 'Исследованная точка' : 'Неизвестная область'}>
                <span class="mi" style={p.explored ? { borderColor: '#8a99a6' } : { borderColor: '#edbb5a', color: '#edbb5a' }}><Icon name={p.explored ? 'flag' : 'question'} size={14} /></span>
              </div>
            ))}
            {w.nests.filter((n) => w.isRevealed(n.x, n.y)).map((n, i) => (
              <div class="mk" key={'n' + i} style={P(n.x, n.y)} data-tip="Гнездо сбойных автоматов"><span class="mi" style={{ background: '#2a1210', borderColor: '#ed5347', color: '#ff7a6b' }}><Icon name="skull" size={14} /></span></div>
            ))}
            {sim.list.filter((e) => (e.type === 'droneport' || e.type === 'radar' || e.type === 'spire' || e.type === 'datacenter') && !e.ghost).map((e) => (
              <div class="mk small" key={'b' + e.id} style={P(e.x + e.w / 2, e.y + e.h / 2)} data-tip="Важная точка"><span class="mi" style={{ borderColor: '#9096db', color: '#c0c4ff' }}><Icon name="mountain" size={12} /></span></div>
            ))}
            {sim.enemies.length > 0 && (() => {
              const en = sim.enemies[0];
              return <div class="mk" style={P(en.x, en.y)}><span class="mi" style={{ background: '#2a1210', borderColor: '#ed5347', color: '#ff7a6b' }}><Icon name="alert" size={14} /></span><span class="ml neg">{sim.enemies.length} врагов</span></div>;
            })()}
          </div>
        )}
      </div>
      <div class="panel smlegend">
        <div class="h2" style={{ marginBottom: 8 }}>Легенда</div>
        {[['home', 'База игрока', '#32c6f4'], ['flag', 'Ресурс', '#33c0a7'], ['mountain', 'Месторождение', '#edbb5a'], ['mountain', 'Важная точка', '#9096db'], ['skull', 'Враг', '#ed5347'], ['question', 'Неизвестная область', '#b7c2cc']].map(([ic, t, c]) => (
          <div class="lg" key={t}><span style={{ color: c }}><Icon name={ic} size={16} /></span>{t}</div>
        ))}
        <div class="divider" />
        <div class="h2" style={{ marginBottom: 8 }}>Биомы</div>
        {LAYERS.map(([k, n, c]) => (
          <button key={k} class={'lg lgb' + (layers[k] ? '' : ' off')} onClick={() => toggle(k)} data-tip="Показать/скрыть слой">
            <span class="sw" style={{ background: c }} />{n}
          </button>
        ))}
        <div class="divider" />
        <div class="muted" style={{ fontSize: 12 }}>{hover ? <>X: {hover.x} Y: {hover.y} · {BIOMES[w.biome[w.idx(hover.x, hover.y)]]?.name}</> : 'Наведите на карту'}</div>
        <div class="muted" style={{ fontSize: 12, marginTop: 4 }}>Клик — перелететь, M — закрыть</div>
      </div>
    </div>
  );
}
