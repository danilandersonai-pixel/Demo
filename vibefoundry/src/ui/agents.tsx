import type { Game } from '../game';
import { ROLES, HIRABLE, canHire, hire, hireCost } from '../ai/agents';
import { ERA_NAMES, ERA_SUB, nextEraRequirements, AGENT_SLOTS } from '../ai/eras';
import { modelVersionLabel } from '../ai/state';
import { TECHS } from '../data/research';
import { Icon } from './icons';
import { Portrait } from './portraits';
import { pct } from './format';
import { Window } from './App';
import { audio } from './audio';

const ERA_ICONS = ['', 'terminal', 'cpu', 'drone', 'home'];

export function AgentsWindow({ game }: { game: Game }) {
  const sim = game.sim;
  const ai = sim.ai;
  const req = nextEraRequirements(sim);
  const close = () => {
    game.ui.panel = null;
    game.emit();
  };
  return (
    <Window title="AI-агенты" icon="agents" width={1120} onClose={close} extra={<span class="muted" style={{ fontSize: 12.5 }}>Создавай агентов, давай им задачи, объединяй в команды и развивай их.</span>}>
      <div class="label" style={{ marginBottom: 8 }}>Развитие ИИ</div>
      <div class="eras">
        {[1, 2, 3, 4].map((e, i) => (
          <>
            {i > 0 && <div class="arrow" key={'a' + e}><Icon name="play" size={16} /></div>}
            <div key={e} class={'era' + (ai.era === e ? ' on' : ai.era > e ? ' done' : '')}>
              <div style={{ color: ai.era >= e ? 'var(--teal)' : 'var(--muted)' }}><Icon name={ERA_ICONS[e]} size={28} /></div>
              <div style={{ color: 'var(--text)', fontWeight: 600, marginTop: 4 }}>{ERA_NAMES[e]}</div>
              <div class="muted" style={{ fontSize: 11.5 }}>({ERA_SUB[e]})</div>
              {ai.era + 1 === e && (
                <div style={{ marginTop: 6, textAlign: 'left' }}>
                  {req.map((r) => <div key={r.text} style={{ fontSize: 11.5, color: r.done ? 'var(--teal-soft)' : 'var(--text-2)' }}><Icon name={r.done ? 'check' : 'circle'} size={11} /> {r.text}</div>)}
                </div>
              )}
            </div>
          </>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, fontSize: 13 }}>
        <span>Модель <b class="mono" style={{ color: 'var(--text)' }}>{modelVersionLabel(ai)}</b></span>
        <span>Слоты агентов <b class="mono" style={{ color: 'var(--text)' }}>{ai.agents.filter((a) => a.role !== 'terminal').length}/{AGENT_SLOTS[ai.era]}</b></span>
        <span>Индекс автономии <b class="mono" style={{ color: 'var(--violet)' }}>{pct(ai.autonomy)}</b></span>
        {ai.era >= 4 && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }} data-tip="Orchestrator сам ставит цели колонии и принимает изменения без игрока">
            <input type="checkbox" checked={!!sim.flags.autopilot} onChange={(e) => { sim.flags.autopilot = (e.target as HTMLInputElement).checked; game.emit(); }} />
            <b style={{ color: 'var(--violet)' }}>Автопилот колонии</b>
          </label>
        )}
      </div>
      <div class="agents-grid">
        {(['terminal', ...HIRABLE] as const).map((role) => {
          const def = ROLES[role];
          const a = ai.agents.find((x) => x.role === role);
          const chk = canHire(sim, role);
          const cost = hireCost(sim);
          return (
            <div class="acard" key={role} style={{ borderColor: a ? def.color + '88' : undefined }}>
              <div class="port"><Portrait role={role} size={88} working={a?.status === 'working'} /></div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <b style={{ color: 'var(--text)', fontSize: 15 }}>{def.name}</b>
                {a && <span class="mono muted" style={{ fontSize: 11 }}>ур. {a.level}</span>}
              </div>
              <div class="muted" style={{ fontSize: 12, minHeight: 32 }}>{def.desc}</div>
              <span class="tag" style={{ color: def.color }}>{def.tag}</span>
              {a ? (
                <>
                  <div style={{ fontSize: 12 }}>
                    Статус: <span style={{ color: a.status === 'working' ? 'var(--teal-soft)' : a.status === 'error' ? 'var(--red-soft)' : 'var(--text-2)' }}>{a.status === 'working' ? 'Работает' : a.status === 'error' ? 'Ошибка' : 'Простаивает'}</span>
                    {' · '}скорость ×{a.speed.toFixed(2)}
                  </div>
                  {a.task ? (
                    <>
                      <div style={{ fontSize: 12 }}>Задача: {a.task.label}, {pct(a.task.progress)}</div>
                      <div class="bar"><i style={{ width: pct(a.task.progress), background: def.color }} /></div>
                    </>
                  ) : (
                    <div class="bar" data-tip={`Опыт: ${a.xp}/${a.level * 5}`}><i style={{ width: pct(a.xp / (a.level * 5)), background: 'var(--muted)' }} /></div>
                  )}
                  <button class="btn small" onClick={() => { game.ui.vibeTarget = a.id; game.ui.panel = 'vibe'; game.emit(); }}><Icon name="chat" size={14} />Дать задачу</button>
                </>
              ) : (
                <>
                  {!chk.ok && <div class="muted" style={{ fontSize: 11.5 }}><Icon name="lock" size={11} /> {chk.reason}{def.unlock && !sim.isUnlocked(def.unlock) ? '' : ''}</div>}
                  <button class={'btn small' + (chk.ok ? ' primary' : '')} disabled={!chk.ok} onClick={() => {
                    const h = hire(sim, role);
                    if (h) {
                      audio.play('tech');
                      game.pushToast({ kind: 'success', title: `Нанят агент ${h.name}`, text: def.greet });
                      sim.ai.chat.push({ id: sim.ai.nextMsgId++, from: 'agent', agentId: h.id, role, text: def.greet, time: sim.time });
                    }
                    game.emit();
                  }} data-tip={def.unlock ? `Исследование: ${TECHS[def.unlock]?.name}` : ''}>
                    Нанять · {cost.compute} выч. + {cost.tokens} ток.
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Window>
  );
}
