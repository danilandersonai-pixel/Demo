import type { JSX } from 'preact';

/** Linear UI icons (24 grid, stroke 1.6, currentColor). */
const UI: Record<string, JSX.Element> = {
  build: <><path d="M14.5 5.5l4 4-9.5 9.5H5v-4z" /><path d="M12.5 7.5l4 4" /><path d="M4 21h16" /></>,
  map: <><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  drone: <><circle cx="12" cy="12" r="2.5" /><path d="M9.8 10.2L6 6.5M14.2 10.2L18 6.5M9.8 13.8L6 17.5M14.2 13.8L18 17.5" /><ellipse cx="5.5" cy="6" rx="3" ry="1.2" /><ellipse cx="18.5" cy="6" rx="3" ry="1.2" /><ellipse cx="5.5" cy="18" rx="3" ry="1.2" /><ellipse cx="18.5" cy="18" rx="3" ry="1.2" /></>,
  stats: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M7 15l4-5 3 3 5-7" /></>,
  research: <><path d="M9 3h6" /><path d="M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3" /><path d="M7.5 15h9" /></>,
  agents: <><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 8V5" /><circle cx="12" cy="4" r="1.2" /><circle cx="9.5" cy="13" r="1.3" /><circle cx="14.5" cy="13" r="1.3" /><path d="M3 12v4M21 12v4" /></>,
  code: <><path d="M8.5 7L4 12l4.5 5" /><path d="M15.5 7L20 12l-4.5 5" /><path d="M13.5 5l-3 14" /></>,
  codex: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /><path d="M8 8h8M8 11.5h6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3" /></>,
  pause: <><path d="M9 6v12M15 6v12" /></>,
  play: <><path d="M8 5.5v13l10-6.5z" /></>,
  fast: <><path d="M4 6v12l8-6zM12 6v12l8-6z" /></>,
  faster: <><path d="M3 6v12l6-6zM9 6v12l6-6zM15 6v12l6-6z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></>,
  moon: <><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
  circle: <><circle cx="12" cy="12" r="8" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  rotate: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
  power: <><path d="M13 2L5 14h6l-1 8 8-12h-6z" /></>,
  git: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10" /><path d="M18 10c0 5-8 4-12 7" /></>,
  commit: <><circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" /></>,
  rollback: <><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  sandbox: <><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  alert: <><path d="M12 3L2 20h20z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.3" /></>,
  success: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  danger: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.2v.3" /></>,
  send: <><path d="M4 12l16-8-6 16-3-7z" /><path d="M11 13l9-9" /></>,
  edit: <><path d="M15 4l5 5L9 20H4v-5z" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /></>,
  sparkle: <><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" /><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></>,
  group: <><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><path d="M17 14v6M14 17h6" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  save: <><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v5h7V3M8 21v-7h8v7" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v4h16v-4" /></>,
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  skull: <><path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.3 4 2 4.8V18h10v-3.2c.7-.8 2-2.3 2-4.8a7 7 0 0 0-7-7z" /><circle cx="9.3" cy="10.5" r="1.4" /><circle cx="14.7" cy="10.5" r="1.4" /><path d="M10 18v3M14 18v3" /></>,
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17v.3" /></>,
  mountain: <><path d="M3 19l6-10 4 6 2-3 6 7z" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  bolt: <><path d="M13 2L5 14h6l-1 8 8-12h-6z" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>,
  wrench: <><path d="M14.5 4.5a4.5 4.5 0 0 0 5 6L11 19a2.1 2.1 0 0 1-3-3l8.5-8.5a4.5 4.5 0 0 1-2-3z" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M12 15h5" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  tree: <><path d="M12 3l6 9h-3l4 6H5l4-6H6z" /><path d="M12 18v3" /></>,
};

export function Icon({ name, size = 20, class: cls, style }: { name: string; size?: number; class?: string; style?: any }) {
  const content = UI[name] ?? UI.circle;
  return (
    <svg class={cls} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {content}
    </svg>
  );
}

/** Coloured resource icons (filled, like the asset sheet). */
const RES: Record<string, (s: number) => JSX.Element> = {
  iron: () => <><path d="M4 9l8-4 8 4-8 4z" fill="#d6d2d4" /><path d="M4 9v6l8 4v-6z" fill="#9a959a" /><path d="M20 9v6l-8 4v-6z" fill="#6e6a70" /></>,
  copper: () => <><path d="M5 9l5-5h5l4 5-7 11z" fill="#e08a55" /><path d="M12 20l7-11-4-5" fill="#a85a32" /><path d="M5 9h14" stroke="#f4b48a" stroke-width="1" /></>,
  silicon: () => <><path d="M12 2l7 9-7 11-7-11z" fill="#e6edf6" /><path d="M12 2l7 9-7 11z" fill="#aeb7cb" /><path d="M5 11h14" stroke="#ffffff" stroke-width="0.8" /></>,
  oil: () => <><path d="M12 3c3.5 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6 6-11z" fill="#1a222d" stroke="#5a6a7a" stroke-width="1" /><path d="M9 14a3 3 0 0 0 3 3" stroke="#8aa0b8" stroke-width="1.2" fill="none" /></>,
  uranium: () => <><path d="M7 20l-2-8 4-7 6 1 4 7-3 7z" fill="#b6de4a" /><path d="M15 6l4 7-3 7-3-9z" fill="#7aa02a" /><circle cx="11" cy="12" r="2" fill="#eaffa0" /></>,
  rare: () => <><path d="M6 20l1-9 3-6 2 6-1 9z" fill="#a7abf0" /><path d="M11 20l2-11 3-5 2 7-2 9z" fill="#7a70c8" /><path d="M15 20l3-7 3 3-2 4z" fill="#c0c4ff" /></>,
  energy: () => <><path d="M13 2L5 14h6l-1 8 8-12h-6z" fill="#f2c14e" stroke="#ffe08a" stroke-width="0.8" /></>,
  compute: () => <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="#0e4a66" stroke="#37d5e9" stroke-width="1.2" /><path d="M4 7.5L12 12l8-4.5M12 12v9" stroke="#37d5e9" stroke-width="1" fill="none" /></>,
  context: () => <><ellipse cx="12" cy="6" rx="7" ry="2.5" fill="#4976be" /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" fill="#2c4f86" /><path d="M5 10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5M5 14c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" stroke="#7ea6e6" stroke-width="1" fill="none" /></>,
  tokens: () => <><circle cx="12" cy="12" r="8.5" fill="#b8902a" stroke="#ecc871" stroke-width="1.5" /><path d="M9 8h6M12 8v8" stroke="#fff1c0" stroke-width="2" /></>,
  data: () => <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="#0b3a36" stroke="#2d9289" stroke-width="1.2" /><path d="M8 10h8M8 13h6M8 16h7" stroke="#5fe0c8" stroke-width="1" /></>,
  weights: () => <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="#10394f" stroke="#7ec5e5" stroke-width="1.2" /><circle cx="9" cy="10" r="1.3" fill="#7ec5e5" /><circle cx="15" cy="10" r="1.3" fill="#7ec5e5" /><circle cx="12" cy="15" r="1.3" fill="#7ec5e5" /><path d="M9 10l3 5 3-5M9 10h6" stroke="#7ec5e5" stroke-width="0.8" /></>,
  stone: () => <><path d="M4 16l2-7 6-3 6 3 2 7-8 4z" fill="#9a9080" /><path d="M12 6l6 3 2 7-8 4z" fill="#6a6258" /></>,
  debt: () => <><path d="M12 3L2 20h20z" fill="#3a2410" stroke="#edbb5a" stroke-width="1.3" /><path d="M12 9v5M12 16.5v.5" stroke="#edbb5a" stroke-width="1.8" /></>,
};

export function ResIcon({ name, size = 22 }: { name: string; size?: number }) {
  const f = RES[name] ?? RES.iron;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {f(size)}
    </svg>
  );
}
