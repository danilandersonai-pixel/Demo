import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../game';
import { Icon } from './icons';
import { listSlots, type SaveMeta, type SlotId } from './saves';
import { audio } from './audio';
import { ERA_NAMES } from '../ai/eras';

function MenuLogo() {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 64, color: 'var(--text)', letterSpacing: -1, lineHeight: 1, textShadow: '0 0 30px rgba(50,198,244,0.35)' }}>
        Vibe<span style={{ color: 'var(--cyan)' }}>Foundry</span>
      </div>
      <div class="label" style={{ marginTop: 10, fontSize: 12 }}>AI × Automation × Vibe coding</div>
      <div style={{ marginTop: 12, color: 'var(--text-2)', fontStyle: 'italic', fontSize: 15 }}>Ты не просто строишь фабрику. Ты создаёшь ИИ, который строит её сам.</div>
    </div>
  );
}

export function SaveList({ game, mode, onDone }: { game: Game; mode: 'load' | 'save'; onDone: () => void }) {
  const [slots, setSlots] = useState<SaveMeta[] | null>(null);
  useEffect(() => {
    listSlots().then(setSlots);
  }, []);
  const ids: SlotId[] = mode === 'save' ? ['slot1', 'slot2', 'slot3'] : ['auto', 'slot1', 'slot2', 'slot3'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ids.map((id) => {
        const m = slots?.find((s) => s.slot === id);
        return (
          <button
            key={id}
            class="btn"
            style={{ justifyContent: 'space-between', minHeight: 48, textAlign: 'left' }}
            disabled={mode === 'load' && !m}
            onClick={async () => {
              if (mode === 'save') await game.saveTo(id);
              else await game.loadFrom(id);
              onDone();
            }}
          >
            <span>
              <b style={{ color: 'var(--text)' }}>{id === 'auto' ? 'Автосохранение' : `Слот ${id.slice(-1)}`}</b>
              <br />
              <span class="muted" style={{ fontSize: 12 }}>{m ? `${m.label} · ${new Date(m.savedAt).toLocaleString('ru-RU')}` : 'пусто'}</span>
            </span>
            <Icon name={mode === 'save' ? 'save' : 'upload'} size={18} />
          </button>
        );
      })}
    </div>
  );
}

export function MainMenu({ game }: { game: Game }) {
  const [view, setView] = useState<'root' | 'new' | 'load' | 'about' | 'settings'>('root');
  const [seed, setSeed] = useState(String(Math.floor(Math.random() * 1e6)));
  const [size, setSize] = useState(256);
  const [peaceful, setPeaceful] = useState(false);
  const [hasAuto, setHasAuto] = useState(false);
  useEffect(() => {
    listSlots().then((s) => setHasAuto(s.length > 0));
  }, []);
  return (
    <div class="menu-screen">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        <MenuLogo />
        <div class="panel glow" style={{ padding: 20, width: 420 }}>
          {view === 'root' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button class="btn primary" style={{ minHeight: 44, fontSize: 15 }} onClick={() => setView('new')}><Icon name="play" size={18} />Новая игра</button>
              {hasAuto && <button class="btn" style={{ minHeight: 44 }} onClick={async () => { if (!(await game.loadLatest())) setView('load'); }}><Icon name="rollback" size={18} />Продолжить</button>}
              <button class="btn" style={{ minHeight: 44 }} onClick={() => setView('load')}><Icon name="upload" size={18} />Загрузить</button>
              {game.demoAvailable && <button class="btn good" style={{ minHeight: 44 }} onClick={() => game.startDemo()}><Icon name="sparkle" size={18} />Демо-сценарий (2 минуты — все механики)</button>}
              <button class="btn" style={{ minHeight: 44 }} onClick={() => setView('settings')}><Icon name="settings" size={18} />Настройки</button>
              <button class="btn ghost" style={{ minHeight: 40 }} onClick={() => setView('about')}><Icon name="info" size={18} />Об игре</button>
            </div>
          )}
          {view === 'new' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div class="h2">Новая игра</div>
              <label class="label">Сид острова</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={seed} onInput={(e) => setSeed((e.target as HTMLInputElement).value)} style={{ flex: 1, padding: '8px 10px' }} class="mono" />
                <button class="btn" onClick={() => setSeed(String(Math.floor(Math.random() * 1e6)))} data-tip="Случайный сид"><Icon name="rotate" size={16} /></button>
              </div>
              <label class="label">Размер острова</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[192, 256, 320].map((s) => (
                  <button key={s} class={'btn' + (size === s ? ' primary' : '')} style={{ flex: 1 }} onClick={() => setSize(s)}>{s === 192 ? 'Малый' : s === 256 ? 'Средний' : 'Большой'} · {s}</button>
                ))}
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={peaceful} onChange={(e) => setPeaceful((e.target as HTMLInputElement).checked)} />
                <span>Мирный режим (без атак сбойных автоматов)</span>
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button class="btn" onClick={() => setView('root')}>Назад</button>
                <button class="btn primary" style={{ flex: 1 }} onClick={() => { audio.startAmbient(); game.newGame({ seed: Number(seed.replace(/\D/g, '')) || 1, size, peaceful }); }}>Высадиться на остров</button>
              </div>
            </div>
          )}
          {view === 'load' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div class="h2">Загрузить</div>
              <SaveList game={game} mode="load" onDone={() => {}} />
              <button class="btn" onClick={() => game.importSave()}><Icon name="upload" size={16} />Импорт из файла…</button>
              <button class="btn ghost" onClick={() => setView('root')}>Назад</button>
            </div>
          )}
          {view === 'settings' && (
            <div>
              <SettingsBody game={game} />
              <button class="btn ghost" style={{ marginTop: 12 }} onClick={() => setView('root')}>Назад</button>
            </div>
          )}
          {view === 'about' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13.5, lineHeight: 1.5 }}>
              <div class="h2">Об игре</div>
              <div>VibeFoundry — Factorio, в котором главный инструмент — ИИ. Стройте конвейеры и цеха, а потом поручайте агентам писать код автоматизации словами: он коммитится в Git фабрики, прогоняется в песочнице и иногда ломает всё из-за галлюцинаций.</div>
              <div class="muted">Вся графика и звук генерируются кодом. Работает офлайн; режим «Настоящий ИИ» — по вашему ключу Anthropic API в настройках.</div>
              <button class="btn ghost" onClick={() => setView('root')}>Назад</button>
            </div>
          )}
        </div>
        <div class="muted mono" style={{ fontSize: 11 }}>v0.1 · сделано автономным агентом за одну сессию</div>
      </div>
    </div>
  );
}

export function SettingsBody({ game }: { game: Game }) {
  const s = game.settings;
  const set = (patch: Partial<typeof s>) => {
    Object.assign(s, patch);
    game.applySettings();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div class="h2">Настройки</div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={s.sound} onChange={(e) => set({ sound: (e.target as HTMLInputElement).checked })} /> Звук и эмбиент
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        Громкость <input type="range" min="0" max="1" step="0.05" value={s.volume} onInput={(e) => set({ volume: Number((e.target as HTMLInputElement).value) })} style={{ flex: 1 }} />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        Масштаб интерфейса
        <select value={String(s.uiScale)} onChange={(e) => set({ uiScale: Number((e.target as HTMLSelectElement).value) })}>
          {[0.8, 0.9, 1, 1.1, 1.25].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={s.highContrast} onChange={(e) => set({ highContrast: (e.target as HTMLInputElement).checked })} /> Повышенный контраст
      </label>
      {!game.ui.mainMenu && (
        <>
          <div class="divider" />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={game.sim.settings.peaceful} onChange={(e) => { game.sim.settings.peaceful = (e.target as HTMLInputElement).checked; if (game.sim.settings.peaceful) game.sim.enemies.length = 0; game.emit(); }} /> Мирный режим
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={game.sim.settings.hallucinations} onChange={(e) => { game.sim.settings.hallucinations = (e.target as HTMLInputElement).checked; game.emit(); }} /> Галлюцинации ИИ (реалистичные баги в коде агентов)
          </label>
        </>
      )}
      {game.renderLlmSettings?.()}
    </div>
  );
}

export function EscMenu({ game }: { game: Game }) {
  const [view, setView] = useState<'root' | 'save' | 'load'>('root');
  return (
    <div class="menu-screen" style={{ background: 'rgba(0,6,14,0.7)' }}>
      <div class="panel glow" style={{ padding: 20, width: 380 }}>
        {view === 'root' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div class="h1" style={{ marginBottom: 6 }}>Пауза</div>
            <div class="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>День {game.sim.day} · эра «{ERA_NAMES[game.sim.ai.era]}»</div>
            <button class="btn primary" onClick={() => { game.ui.panel = null; game.emit(); }}>Продолжить</button>
            <button class="btn" onClick={() => setView('save')}><Icon name="save" size={16} />Сохранить</button>
            <button class="btn" onClick={() => setView('load')}><Icon name="upload" size={16} />Загрузить</button>
            <button class="btn" onClick={() => game.exportSave()}><Icon name="download" size={16} />Экспорт в файл</button>
            <button class="btn" onClick={() => game.importSave()}><Icon name="upload" size={16} />Импорт из файла</button>
            <button class="btn" onClick={() => { game.ui.panel = 'settings'; game.emit(); }}><Icon name="settings" size={16} />Настройки</button>
            <button class="btn bad" onClick={() => { game.ui.mainMenu = true; game.ui.panel = null; game.emit(); }}>Главное меню</button>
          </div>
        )}
        {view !== 'root' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div class="h2">{view === 'save' ? 'Сохранить' : 'Загрузить'}</div>
            <SaveList game={game} mode={view} onDone={() => setView('root')} />
            <button class="btn ghost" onClick={() => setView('root')}>Назад</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Styled tooltip following [data-tip] elements. */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const over = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!el) {
        setTip(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTip({ text: el.getAttribute('data-tip') ?? '', x: r.left + r.width / 2, y: r.bottom + 8 });
    };
    const out = () => setTip(null);
    document.addEventListener('mouseover', over);
    document.addEventListener('mousedown', out);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousedown', out);
    };
  }, []);
  if (!tip || !tip.text) return null;
  const left = Math.max(8, Math.min(window.innerWidth - 290, tip.x - 140));
  const top = tip.y + 120 > window.innerHeight ? tip.y - 90 : tip.y;
  return <div class="tooltip" style={{ left, top }}>{tip.text}</div>;
}
