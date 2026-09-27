import { useEffect, useRef, useState } from 'preact/hooks';
import type { Game } from '../game';
import type { ChatMsg, Proposal } from '../ai/state';
import { modelVersionLabel } from '../ai/state';
import { ROLES } from '../ai/agents';
import { ERA_NAMES } from '../ai/eras';
import { requestCost, sendRequest, acceptProposal, rejectProposal, editProposal, rollbackTo, snapshotAffordable, tagLabel } from '../vibe/vibe';
import { diffLines, diffStat, headCommit, type Commit } from '../vibe/git';
import { contextCapacity, contextNeeded } from '../ai/context';
import { INTENT_TEMPLATES } from '../vibe/intent';
import { Icon, ResIcon } from './icons';
import { Portrait } from './portraits';
import { CodeView, DiffView } from './code';
import { fmt, gameTime, pct } from './format';
import { audio } from './audio';

const MANDATORY = [
  'Сделай так, чтобы медная руда автоматически доставлялась на переработку, приоритет отдавался аккумуляторам, а если энергии не хватает — временно отключай производство микросхем.',
  'Если железных пластин больше 1000 — останови плавильни железа.',
  'Держи запас аккумуляторов на уровне 500.',
  'Когда энергия ниже 20%, выключи химзавод.',
  'Ночью отключай всё, кроме серверов.',
  'Уведоми меня, если производство чипов упадёт ниже 50 в минуту.',
  'Переключи сборщики группы line_b на модули памяти.',
  'Отправь дрона исследовать ближайшую неизвестную область.',
  'Распредели медные пластины поровну между двумя линиями.',
  'Make batteries top priority when power is low.',
];

const TAG_ICON: Record<string, { icon: string; color: string }> = {
  base: { icon: 'commit', color: 'var(--teal)' },
  ai: { icon: 'sparkle', color: 'var(--teal)' },
  fix: { icon: 'wrench', color: 'var(--amber)' },
  catastrophe: { icon: 'danger', color: 'var(--red)' },
  refactor: { icon: 'layers', color: 'var(--cyan)' },
  rollback: { icon: 'rollback', color: 'var(--violet)' },
  manual: { icon: 'edit', color: 'var(--text-2)' },
};

export function VibeWindow({ game }: { game: Game }) {
  const sim = game.sim;
  const ai = sim.ai;
  const terminal = ai.era <= 1;
  const [text, setText] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [view, setView] = useState<'code' | 'diff'>('code');
  const [editing, setEditing] = useState<string | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [gitSel, setGitSel] = useState<number | null>(null);
  const [showEx, setShowEx] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const pending = [...ai.proposals].reverse().find((p) => p.status === 'pending' || p.status === 'sandbox');
  const selId = sel ?? pending?.id ?? null;
  const prop = selId != null ? ai.proposals.find((p) => p.id === selId) ?? null : null;
  const target = game.ui.vibeTarget;
  const cost = requestCost(sim, text || 'x');
  const chatLen = ai.chat.length;
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatLen]);

  const send = (t = text) => {
    if (!t.trim()) return;
    if (game.llm.active()) void game.llm.request(t, target ?? undefined);
    else sendRequest(sim, t, target ?? undefined);
    setText('');
    setSel(null);
    audio.play('click');
    game.emit();
  };

  const close = () => {
    game.ui.panel = null;
    game.emit();
  };

  return (
    <div class={'panel glow window vibe' + (terminal ? ' terminal' : '') + (ai.era >= 4 ? ' colony' : '')} style={{ width: 'min(1340px, calc(100vw - 32px))', height: 'min(760px, calc(100vh - 190px))' }}>
      <div class="whdr">
        <span style={{ color: terminal ? '#6fdc5a' : 'var(--cyan)' }}><Icon name={terminal ? 'terminal' : 'code'} size={20} /></span>
        <div class="h1" style={{ fontSize: 19 }}>{terminal ? 'ИИ в терминале' : 'Вайб-кодинг'}</div>
        <span class="muted" style={{ fontSize: 12.5 }}>Просто опиши задачу — ИИ напишет код, настроит логику и запустит автоматизацию.</span>
        <button class="xbtn" onClick={close} data-tip="Закрыть (Tab / Esc)"><Icon name="close" size={16} /></button>
      </div>
      <div class="vibe-cols">
        {/* ---------------- column 1: you */}
        <div class="vcol">
          <div class="vhead"><Icon name="chat" size={16} /> Ты</div>
          <div class="chat scroll" ref={chatRef}>
            {ai.chat.map((m) => <ChatBubble key={m.id} m={m} game={game} onSelect={(id) => { setSel(id); setEditing(null); }} selected={m.proposalId === selId} onOption={(t) => send(t)} />)}
          </div>
          {showEx && (
            <div class="examples scroll">
              {[...MANDATORY, ...INTENT_TEMPLATES.map((t) => t.example)].filter((v, i, a) => a.indexOf(v) === i).map((ex) => (
                <button key={ex} class="ex" onClick={() => { setText(ex); setShowEx(false); }}>{ex}</button>
              ))}
            </div>
          )}
          <div class="composer">
            <textarea
              value={text}
              placeholder={terminal ? '> опишите задачу…' : 'Например: «Держи запас аккумуляторов на уровне 500»'}
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={3}
            />
            <div class="crow">
              <select value={target == null ? '' : String(target)} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; game.ui.vibeTarget = v ? Number(v) : null; game.emit(); }} data-tip="Кому адресовать запрос">
                <option value="">Авто (лучший агент)</option>
                {ai.agents.map((a) => <option key={a.id} value={a.id}>{a.name} — {ROLES[a.role].tag}</option>)}
              </select>
              <button class="btn small ghost" onClick={() => setShowEx(!showEx)} data-tip="Примеры запросов"><Icon name="sparkle" size={14} />Примеры</button>
              <span class="muted mono" style={{ fontSize: 11, marginLeft: 'auto' }} data-tip="Стоимость запроса: длина + контекст фабрики">≈{cost} ток.</span>
              <button class="btn primary small" disabled={!text.trim() || ai.tokens < cost} onClick={() => send()}><Icon name="send" size={14} />Отправить</button>
            </div>
          </div>
        </div>
        {/* ---------------- column 2: agent */}
        <div class="vcol wide">
          <div class="vhead"><Icon name="agents" size={16} /> AI Agent {prop && <span class="muted" style={{ marginLeft: 6 }}>· {prop.message}</span>}</div>
          {prop ? (
            <ProposalView game={game} p={prop} view={view} setView={setView} editing={editing} setEditing={setEditing} editErr={editErr} setEditErr={setEditErr} />
          ) : (
            <ScriptsOverview game={game} />
          )}
        </div>
        {/* ---------------- column 3: git / agents / resources */}
        <div class="vcol">
          <div class="vhead"><Icon name="git" size={16} /> Версии / Git</div>
          <GitList game={game} sel={gitSel} setSel={setGitSel} />
          <div class="vhead" style={{ marginTop: 10 }}><Icon name="agents" size={16} /> Активные агенты</div>
          <div class="alist">
            {ai.agents.map((a) => (
              <div class="arow" key={a.id}>
                <span class="dot" style={{ background: ROLES[a.role].color }} />
                <span style={{ flex: 1 }}>{a.name}</span>
                {a.status === 'working' && a.task ? (
                  <span class="mono muted" style={{ fontSize: 11 }}>{a.task.label} {pct(a.task.progress)}</span>
                ) : (
                  <span style={{ color: a.status === 'error' ? 'var(--red)' : 'var(--teal)' }}><Icon name={a.status === 'error' ? 'danger' : 'check'} size={14} /></span>
                )}
              </div>
            ))}
          </div>
          <div class="vhead" style={{ marginTop: 10 }}><Icon name="cpu" size={16} /> Ресурсы ИИ</div>
          <div class="aires">
            <div class="row2"><ResIcon name="context" size={16} /> Контекст <b class="mono">{fmt(contextNeeded(sim))}/{fmt(contextCapacity(sim))}k</b></div>
            <div class="row2"><ResIcon name="compute" size={16} /> Вычисления <b class="mono">{fmt(ai.compute)}</b></div>
            <div class="row2"><ResIcon name="tokens" size={16} /> Токены <b class="mono">{fmt(ai.tokens)}</b></div>
            <div class="row2"><ResIcon name="data" size={16} /> Данные <b class="mono">{fmt(ai.data)}</b></div>
            <div class="row2"><ResIcon name="debt" size={16} /> Техдолг <b class="mono" style={{ color: ai.techDebt > 40 ? 'var(--red-soft)' : ai.techDebt > 15 ? 'var(--amber-soft)' : 'var(--teal-soft)' }}>{Math.round(ai.techDebt)}</b></div>
            <div class="bar" style={{ margin: '2px 0 6px' }}><i style={{ width: pct(Math.min(1, ai.techDebt / 100)), background: ai.techDebt > 40 ? 'var(--red)' : 'var(--amber)' }} /></div>
            <div class="row2 muted"><ResIcon name="weights" size={16} /> Модель: <b class="mono" style={{ color: 'var(--text)' }}>{modelVersionLabel(ai)}</b> · эра «{ERA_NAMES[ai.era]}»</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ m, game, onSelect, selected, onOption }: { m: ChatMsg; game: Game; onSelect: (pid: number) => void; selected: boolean; onOption: (t: string) => void }) {
  if (m.from === 'system') return <div class="sysmsg">{m.text}</div>;
  if (m.from === 'player') {
    return (
      <div class="bubble me">
        <div class="who"><Icon name="chat" size={13} /> Ты → {m.role ? ROLES[m.role].name : 'ИИ'}</div>
        <div>{m.text}</div>
      </div>
    );
  }
  const role = m.role ?? 'terminal';
  return (
    <div class={'bubble ai' + (selected ? ' sel' : '')} onClick={() => m.proposalId && onSelect(m.proposalId)} style={{ cursor: m.proposalId ? 'pointer' : 'default' }}>
      <div class="who" style={{ color: ROLES[role].color }}><Portrait role={role} size={20} /> {ROLES[role].name} <span class="muted mono" style={{ marginLeft: 'auto', fontSize: 10.5 }}>{gameTime(m.time)}</span></div>
      <div style={{ whiteSpace: 'pre-line' }}>{m.text}</div>
      {m.steps && (
        <div class="steps">
          {m.steps.map((s, i) => (
            <div key={i} class="step"><span style={{ color: s.done ? 'var(--teal)' : 'var(--muted)' }}><Icon name={s.done ? 'check' : 'circle'} size={13} /></span> <b style={{ color: ROLES[s.role].color }}>{ROLES[s.role].name}</b>: {s.text}</div>
          ))}
        </div>
      )}
      {m.checklist && (
        <div class="checklist">
          {m.checklist.map((c) => <div key={c}><span style={{ color: 'var(--teal)' }}><Icon name="check" size={13} /></span> {c}</div>)}
        </div>
      )}
      {m.options && (
        <div class="opts">
          {m.options.map((o) => <button key={o.text} class="btn small" onClick={() => onOption(o.text)}>{o.label}</button>)}
        </div>
      )}
      {m.proposalId && <div class="muted" style={{ fontSize: 11, marginTop: 4 }}>{selected ? 'Открыто справа →' : 'Нажмите, чтобы открыть код →'}</div>}
      {void game}
    </div>
  );
}

function ProposalView({ game, p, view, setView, editing, setEditing, editErr, setEditErr }: {
  game: Game; p: Proposal; view: 'code' | 'diff'; setView: (v: 'code' | 'diff') => void; editing: string | null; setEditing: (s: string | null) => void; editErr: string | null; setEditErr: (s: string | null) => void;
}) {
  const sim = game.sim;
  const agent = sim.ai.agents.find((a) => a.id === p.agentId);
  const role = p.role;
  const sandboxUnlocked = sim.isUnlocked('sandbox');
  const job = game.sandbox && game.sandbox.pid === p.id ? game.sandbox.job : null;
  const [snap, setSnap] = useState(false);
  const accept = () => {
    if (p.kind === 'blueprint') {
      game.useBlueprint(p);
      return;
    }
    const c = acceptProposal(sim, p.id, { snapshot: snap });
    if (c) game.pushToast({ kind: 'success', title: `Коммит ${c.version}`, text: c.message });
    game.emit();
  };
  if (p.kind === 'blueprint' && p.blueprint) {
    return (
      <div class="prop">
        <div class="pstatus"><Icon name="success" size={16} /> Чертёж готов. {p.status === 'accepted' ? 'Размещён.' : 'Укажите место на карте.'}</div>
        <div class="checklist">{p.checklist.map((c) => <div key={c}><span style={{ color: 'var(--teal)' }}><Icon name="check" size={13} /></span> {c}</div>)}</div>
        <div class="bp-preview"><BlueprintPreview entities={p.blueprint.entities} /></div>
        <div class="pactions">
          {p.status === 'pending' && <button class="btn primary" onClick={accept}><Icon name="pin" size={16} />Принять и указать место</button>}
          {p.status === 'pending' && <button class="btn" onClick={() => { game.placeBlueprintNearBase(p); game.emit(); }}><Icon name="home" size={16} />Поставить у базы</button>}
          {p.status === 'pending' && <button class="btn bad" onClick={() => { rejectProposal(sim, p.id); game.emit(); }}>Отклонить</button>}
        </div>
      </div>
    );
  }
  const diff = diffLines(p.prevCode, p.code);
  const st = diffStat(diff);
  return (
    <div class="prop">
      <div class="pstatus" style={{ color: 'var(--teal-soft)' }}>
        <Portrait role={role} size={22} working={agent?.status === 'working'} />
        {p.status === 'accepted' ? '✓ Изменения приняты и работают.' : p.status === 'rejected' ? 'Отклонено.' : '✓ Задача выполнена. Создан код и настроена логика.'}
      </div>
      <div class="checklist two">{p.checklist.map((c) => <div key={c}><span style={{ color: 'var(--teal)' }}><Icon name="check" size={13} /></span> {c}</div>)}</div>
      <div class="ptabs">
        <span class="file mono"><Icon name="codex" size={13} /> {p.fileName || 'automation.py'}</span>
        <button class={view === 'code' ? 'on' : ''} onClick={() => setView('code')}>Код</button>
        <button class={view === 'diff' ? 'on' : ''} onClick={() => setView('diff')}>Дифф <span class="pos">+{st.add}</span> <span class="neg">−{st.del}</span></button>
        <span style={{ marginLeft: 'auto' }} class="mono muted">{p.tokens ? `${p.tokens} ток. · ` : ''}уверенность {pct(p.confidence)}</span>
      </div>
      {editing !== null ? (
        <div class="editor">
          <textarea class="mono" value={editing} spellcheck={false} onInput={(e) => setEditing((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const ta = e.target as HTMLTextAreaElement;
              const s = ta.selectionStart;
              setEditing(editing.slice(0, s) + '    ' + editing.slice(ta.selectionEnd));
              setTimeout(() => ta.setSelectionRange(s + 4, s + 4));
            }
          }} />
          {editErr && <div class="neg" style={{ fontSize: 12.5, marginTop: 4 }}><Icon name="danger" size={13} /> {editErr}</div>}
          <div class="pactions">
            <button class="btn primary" onClick={() => {
              const r = editProposal(sim, p.id, editing);
              if (r.ok) { setEditing(null); setEditErr(null); } else setEditErr(r.error ?? 'Ошибка');
              game.emit();
            }}>Сохранить правку</button>
            <button class="btn" onClick={() => { setEditing(null); setEditErr(null); }}>Отмена</button>
          </div>
        </div>
      ) : view === 'code' ? <CodeView code={p.code} maxHeight={300} /> : <DiffView diff={diff} maxHeight={300} />}
      <div class="genpill"><Icon name="check" size={13} /> Код сгенерирован ИИ{p.edited ? ' · правлен вручную' : ''}</div>
      {job && !job.done && (
        <div style={{ margin: '8px 0' }}>
          <div class="muted" style={{ fontSize: 12 }}>Песочница: клон фабрики симулируется вперёд на 90 с… {pct(job.progress)}</div>
          <div class="bar"><i style={{ width: pct(job.progress), background: 'var(--violet)' }} /></div>
        </div>
      )}
      {p.forecast && (
        <div class="forecast">
          <div class="label" style={{ marginBottom: 4 }}>Прогноз песочницы · {p.forecast.seconds} с</div>
          {p.forecast.rows.map((r) => {
            const d = r.before > 0.5 ? (r.after - r.before) / r.before : r.after > 0.5 ? 1 : 0;
            return (
              <div class="frow" key={r.key}>
                <span>{r.label}</span>
                <span class="mono">{fmt(r.before)} → <b>{fmt(r.after)}</b>{r.unit}</span>
                <span class={'mono ' + (d > 0.01 ? 'pos' : d < -0.01 ? 'neg' : 'muted')}>{d ? `${d > 0 ? '+' : ''}${Math.round(d * 100)}%` : '±0'}</span>
              </div>
            );
          })}
          <div class="frow"><span>Энергия</span><span class="mono">{pct(p.forecast.powerBefore)} → <b>{pct(p.forecast.powerAfter)}</b></span><span class={p.forecast.powerAfter >= p.forecast.powerBefore ? 'pos mono' : 'neg mono'}>{p.forecast.powerAfter >= p.forecast.powerBefore ? '✓' : '▼'}</span></div>
          {p.forecast.tests && p.forecast.tests.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {p.forecast.tests.map((t) => <div key={t.name} class={t.pass ? 'pos' : 'neg'} style={{ fontSize: 12.5 }}><Icon name={t.pass ? 'success' : 'danger'} size={13} /> CI: {t.name}</div>)}
            </div>
          )}
        </div>
      )}
      {(p.status === 'pending' || p.status === 'sandbox') && (
        <div class="pactions">
          <button class="btn primary" onClick={accept} data-tip={p.sandboxed ? 'Коммит в Git фабрики. Прогнан в песочнице — техдолг минимален.' : 'Коммит в Git фабрики без проверки: +4 техдолга'}><Icon name="check" size={16} />Принять</button>
          <button class="btn" onClick={() => { setEditing(p.code); setEditErr(null); }}><Icon name="edit" size={16} />Редактировать</button>
          <button class="btn bad" onClick={() => { rejectProposal(sim, p.id); game.emit(); }}><Icon name="close" size={16} />Отклонить</button>
          {sandboxUnlocked && <button class="btn" style={{ borderColor: 'var(--violet)', color: '#c0c4ff' }} disabled={!!job && !job.done} onClick={() => game.runSandbox(p.id)} data-tip="Прогнать ветку на клоне фабрики 90 с и показать прогноз"><Icon name="sandbox" size={16} />Прогнать в песочнице</button>}
          {snapshotAffordable(sim) && sim.ai.era >= 2 && (
            <label class="muted" style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }} data-tip="Полный снимок фабрики (включая здания) — стоит 4k памяти контекста">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap((e.target as HTMLInputElement).checked)} /> полный снимок
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function BlueprintPreview({ entities }: { entities: { type: string; dx: number; dy: number }[] }) {
  const w = Math.max(...entities.map((e) => e.dx)) + 3;
  const h = Math.max(...entities.map((e) => e.dy)) + 3;
  const s = Math.min(14, 420 / w);
  const col: Record<string, string> = { belt: '#3a4450', inserter: '#d9a227', pole: '#8a6a44', pipe: '#8a949c', smelter: '#7a4a36', assembler: '#2a3440', assembler2: '#333a4a', chem: '#3c4a4a' };
  const size: Record<string, number> = { smelter: 2, assembler: 3, assembler2: 3, chem: 3 };
  return (
    <svg width={w * s} height={h * s} style={{ display: 'block', margin: '0 auto' }}>
      {entities.map((e, i) => {
        const z = size[e.type] ?? 1;
        return <rect key={i} x={e.dx * s} y={e.dy * s} width={z * s - 1} height={z * s - 1} rx={z > 1 ? 3 : 1} fill={col[e.type] ?? '#555'} stroke={z > 1 ? '#32c6f4' : 'none'} stroke-width="1" />;
      })}
    </svg>
  );
}

function ScriptsOverview({ game }: { game: Game }) {
  const rt = game.sim.scripts;
  if (!rt.instances.length && !rt.fileStatus.length) {
    return (
      <div class="empty">
        <div style={{ color: 'var(--cyan)' }}><Icon name="sparkle" size={34} /></div>
        <div class="h2" style={{ marginTop: 8 }}>Пока нет автоматизации</div>
        <div class="muted" style={{ maxWidth: 420, textAlign: 'center', marginTop: 6 }}>Опишите задачу слева обычными словами. Агент напишет FactoryScript, вы примете изменения — и фабрика начнёт управлять собой.</div>
      </div>
    );
  }
  return (
    <div class="scroll" style={{ flex: 1, minHeight: 0 }}>
      {rt.fileStatus.map((f) => (
        <div key={f.file} class="sfile">
          <div class="mono" style={{ color: 'var(--text)' }}><Icon name="codex" size={13} /> {f.file} {!f.active && <span class="warn">· нет слота в этой эре</span>}</div>
          {f.error && <div class="neg" style={{ fontSize: 12 }}>Синтаксис, строка {f.error.line}: {f.error.message}</div>}
          {rt.instances.filter((i) => i.file === f.file).map((i) => (
            <div key={i.key} class="sinst">
              <span class="dot" style={{ background: i.status === 'ok' ? 'var(--teal)' : i.status === 'error' ? 'var(--red)' : 'var(--amber)' }} />
              <b>{i.cls.name}</b>
              <span class="muted mono" style={{ fontSize: 11 }}>каждые {i.every} с · {i.lastOps} оп. · запусков {i.runs}</span>
              {i.error && <div class="neg" style={{ fontSize: 12, width: '100%' }}>Строка {i.error.line}: {i.error.message}</div>}
              {i.logs.slice(-3).map((l, k) => <div key={k} class={'mono ' + (l.level === 'warn' ? 'warn' : l.level === 'error' ? 'neg' : 'muted')} style={{ fontSize: 11, width: '100%' }}>[{gameTime(l.t)}] {l.text}</div>)}
            </div>
          ))}
          <CodeView code={game.sim.scripts.files()[f.file] ?? ''} maxHeight={200} errorLine={f.error?.line} />
        </div>
      ))}
    </div>
  );
}

function GitList({ game, sel, setSel }: { game: Game; sel: number | null; setSel: (n: number | null) => void }) {
  const sim = game.sim;
  const head = headCommit(sim.git);
  const commits = [...sim.git.commits].reverse();
  const selected = sel != null ? sim.git.commits.find((c) => c.id === sel) : null;
  return (
    <div class="git scroll">
      {commits.map((c) => {
        const t = TAG_ICON[c.tag ?? 'manual'] ?? TAG_ICON.manual;
        return (
          <div key={c.id}>
            <div class={'gitrow' + (c.id === head?.id ? ' head' : '') + (sel === c.id ? ' sel' : '')} onClick={() => setSel(sel === c.id ? null : c.id)}>
              <span style={{ color: t.color }}><Icon name={t.icon} size={16} /></span>
              <b class="mono">{c.version}</b>
              <span class="gmsg">{c.tag ? tagLabel(c.tag) : c.message}</span>
              {c.id === head?.id && <span class="tag" style={{ color: 'var(--teal)' }}>Текущая</span>}
              {c.snapshot && <span data-tip="Есть полный снимок фабрики"><Icon name="save" size={12} /></span>}
            </div>
            {selected && selected.id === c.id && <CommitDetails game={game} c={c} isHead={c.id === head?.id} />}
          </div>
        );
      })}
    </div>
  );
}

function CommitDetails({ game, c, isHead }: { game: Game; c: Commit; isHead: boolean }) {
  const sim = game.sim;
  const parent = sim.git.commits.find((x) => x.id === c.parent);
  const files = Object.keys({ ...c.files, ...(parent?.files ?? {}) });
  return (
    <div class="gitdet">
      <div class="muted" style={{ fontSize: 12 }}>{c.message} · {c.author} · {gameTime(c.time)}{c.techDebtAdded ? ` · техдолг ${c.techDebtAdded > 0 ? '+' : ''}${c.techDebtAdded}` : ''}</div>
      {files.map((f) => {
        const d = diffLines(parent?.files[f] ?? '', c.files[f] ?? '');
        const s = diffStat(d);
        if (!s.add && !s.del) return null;
        return (
          <div key={f}>
            <div class="mono" style={{ fontSize: 11.5, margin: '4px 0' }}>{f} <span class="pos">+{s.add}</span> <span class="neg">−{s.del}</span></div>
            <DiffView diff={d} maxHeight={160} />
          </div>
        );
      })}
      {!isHead && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button class="btn small" onClick={() => { const r = rollbackTo(sim, c.id); if (r) game.pushToast({ kind: 'info', title: `Rollback to ${c.version}`, text: 'Скрипты, группы и приоритеты восстановлены' }); game.emit(); }}>
            <Icon name="rollback" size={14} />Rollback to {c.version}
          </button>
          {c.snapshot && <button class="btn small bad" onClick={() => game.restoreSnapshot(c.id)} data-tip="Полностью вернуть фабрику, включая расстановку зданий"><Icon name="save" size={14} />Полный откат</button>}
        </div>
      )}
    </div>
  );
}
