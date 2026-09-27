import type { AgentRole } from '../ai/state';
import { ROLES } from '../ai/agents';

/** Procedural SVG robot portraits in the role colour (asset sheet: Architect/Coder/Debugger/Optimizer/Orchestrator). */
export function Portrait({ role, size = 72, working = false }: { role: AgentRole; size?: number; working?: boolean }) {
  const c = ROLES[role].color;
  const body = role === 'debugger' ? '#3a2a2a' : role === 'orchestrator' ? '#2a2640' : role === 'terminal' ? '#101a14' : '#dfe6ec';
  const head = role === 'debugger' ? '#4a3434' : role === 'orchestrator' ? '#34305a' : role === 'terminal' ? '#0c140f' : '#eef3f6';
  const shade = role === 'debugger' || role === 'orchestrator' || role === 'terminal' ? '#1a1a24' : '#9aa6b0';
  const id = 'g' + role;
  if (role === 'terminal') {
    return (
      <svg width={size} height={size} viewBox="0 0 72 72">
        <rect x="8" y="12" width="56" height="40" rx="5" fill="#050a07" stroke={c} stroke-width="2" />
        <text x="14" y="30" fill={c} font-family="IBM Plex Mono, monospace" font-size="11">&gt;_</text>
        <rect x="14" y="36" width={working ? 30 : 14} height="3" fill={c}>
          {working && <animate attributeName="width" values="6;34;6" dur="1.2s" repeatCount="indefinite" />}
        </rect>
        <rect x="26" y="54" width="20" height="6" fill="#1a2420" />
        <rect x="18" y="60" width="36" height="4" rx="2" fill="#1a2420" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 72 72">
      <defs>
        <radialGradient id={id} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stop-color={c} stop-opacity="0.35" />
          <stop offset="100%" stop-color={c} stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="36" cy="34" r="34" fill={`url(#${id})`} />
      {/* shoulders */}
      <path d="M10 70 C12 54 22 48 36 48 C50 48 60 54 62 70 Z" fill={body} />
      <path d="M36 48 C50 48 60 54 62 70 L48 70 C48 60 44 52 36 50 Z" fill={shade} opacity="0.35" />
      {/* neck */}
      <rect x="31" y="40" width="10" height="9" fill={shade} />
      {/* head */}
      <rect x="18" y="12" width="36" height="31" rx={role === 'orchestrator' ? 6 : 13} fill={head} />
      {role === 'orchestrator' && <path d="M18 18 L36 4 L54 18 Z" fill={head} />}
      {role === 'debugger' && <path d="M22 12 L36 6 L50 12 Z" fill="#2a1a1a" />}
      {/* visor */}
      <rect x="22" y="20" width="28" height="13" rx="6.5" fill="#0a1218" />
      <circle cx="30" cy="26.5" r="3" fill={c}>
        {working && <animate attributeName="opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite" />}
      </circle>
      <circle cx="42" cy="26.5" r="3" fill={c}>
        {working && <animate attributeName="opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite" />}
      </circle>
      {/* ear lights */}
      <rect x="15" y="22" width="4" height="10" rx="2" fill={c} opacity="0.8" />
      <rect x="53" y="22" width="4" height="10" rx="2" fill={c} opacity="0.8" />
      {/* role emblem on chest */}
      {role === 'architect' && <g transform="translate(26 54)"><rect width="20" height="13" rx="2" fill="#0e2a4a" stroke={c} /><path d="M3 4h14M3 8h9M10 2v10" stroke={c} stroke-width="1" /></g>}
      {role === 'coder' && <g transform="translate(24 55)"><rect width="24" height="12" rx="2" fill="#0a1a26" stroke={c} /><path d="M8 3l-3 3 3 3M16 3l3 3-3 3" stroke={c} stroke-width="1.4" fill="none" /></g>}
      {role === 'debugger' && <path d="M36 54 L45 67 L27 67 Z" fill="#2a0e0c" stroke={c} stroke-width="1.5" />}
      {role === 'debugger' && <path d="M36 58v4M36 64.2v.6" stroke={c} stroke-width="1.6" />}
      {role === 'optimizer' && <g transform="translate(25 55)"><rect width="22" height="12" rx="2" fill="#07261f" stroke={c} /><path d="M3 9l5-4 4 3 7-6" stroke={c} stroke-width="1.4" fill="none" /></g>}
      {role === 'orchestrator' && <path d="M36 53 L44 66 L28 66 Z" fill="none" stroke={c} stroke-width="2" />}
    </svg>
  );
}
