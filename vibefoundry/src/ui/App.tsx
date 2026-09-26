import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../game';
import { TopBar, Quests, Minimap, Toasts, Toolbar, BuildMenu, ToolHint, InfoPanel, CoordPanel, PerfOverlay, GroupPrompt } from './hud';
import { MainMenu, EscMenu, SettingsBody, Tooltip } from './menus';
import { Icon } from './icons';
import { buildThumbs, onThumbs } from './thumbs';
import './hud.css';

export function useGame(game: Game): number {
  const [, setV] = useState(0);
  useEffect(() => game.subscribe(() => setV((v) => v + 1)), [game]);
  return game.version;
}

export function Window({ title, icon, onClose, width, children, extra }: { title: string; icon?: string; onClose: () => void; width: number; children: any; extra?: any }) {
  return (
    <div class="panel glow window" style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
      <div class="whdr">
        {icon && <span style={{ color: 'var(--cyan)' }}><Icon name={icon} size={20} /></span>}
        <div class="h1" style={{ fontSize: 19 }}>{title}</div>
        {extra}
        <button class="xbtn" onClick={onClose} data-tip="Закрыть (Esc)"><Icon name="close" size={16} /></button>
      </div>
      <div class="wbody scroll">{children}</div>
    </div>
  );
}

export function App({ game }: { game: Game }) {
  useGame(game);
  const [, setThumbs] = useState(0);
  useEffect(() => {
    onThumbs(() => setThumbs((v) => v + 1));
    void buildThumbs(game.renderer);
    game.applySettings();
  }, []);
  const ui = game.ui;
  const close = () => { ui.panel = null; game.emit(); };
  const scale = game.settings.uiScale;
  if (ui.mainMenu) return <div class="hud-root"><MainMenu game={game} /><Tooltip /></div>;
  return (
    <div class="hud-root" style={{ transform: scale !== 1 ? `scale(${scale})` : undefined, width: `${100 / scale}%`, height: `${100 / scale}%` }}>
      <TopBar game={game} />
      <Quests game={game} />
      <Minimap game={game} />
      <Toasts game={game} />
      <InfoPanel game={game} />
      <CoordPanel game={game} />
      <Toolbar game={game} />
      {ui.panel === 'build' && <BuildMenu game={game} />}
      <ToolHint game={game} />
      <PerfOverlay game={game} />
      <GroupPrompt game={game} />
      {ui.panel === 'settings' && <Window title="Настройки" icon="settings" width={460} onClose={close}><SettingsBody game={game} /></Window>}
      {ui.panel === 'menu' && <EscMenu game={game} />}
      <Tooltip />
    </div>
  );
}
