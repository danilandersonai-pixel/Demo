import type { Accent } from '../../game/types.ts';

// Tailwind видит только статические имена классов, поэтому палитра расписана явно.
export const ACCENT: Record<
  Accent,
  { text: string; bg: string; soft: string; border: string; glow: string; ring: string; hex: string; from: string }
> = {
  credit: {
    text: 'text-credit',
    bg: 'bg-credit',
    soft: 'bg-credit/10',
    border: 'border-credit/40',
    glow: 'glow-credit',
    ring: 'ring-credit/70',
    hex: '#35f2a1',
    from: 'from-credit/15',
  },
  data: {
    text: 'text-data',
    bg: 'bg-data',
    soft: 'bg-data/10',
    border: 'border-data/40',
    glow: 'glow-data',
    ring: 'ring-data/70',
    hex: '#2bd9f5',
    from: 'from-data/15',
  },
  energy: {
    text: 'text-energy',
    bg: 'bg-energy',
    soft: 'bg-energy/10',
    border: 'border-energy/40',
    glow: 'glow-energy',
    ring: 'ring-energy/70',
    hex: '#ffb23f',
    from: 'from-energy/15',
  },
  research: {
    text: 'text-research',
    bg: 'bg-research',
    soft: 'bg-research/10',
    border: 'border-research/40',
    glow: 'glow-research',
    ring: 'ring-research/70',
    hex: '#b18cff',
    from: 'from-research/15',
  },
  danger: {
    text: 'text-danger',
    bg: 'bg-danger',
    soft: 'bg-danger/10',
    border: 'border-danger/40',
    glow: 'glow-danger',
    ring: 'ring-danger/70',
    hex: '#ff4d6d',
    from: 'from-danger/15',
  },
};

export const TONE_TEXT: Record<string, string> = {
  info: 'text-muted',
  success: 'text-credit',
  warning: 'text-energy',
  danger: 'text-danger',
  event: 'text-research',
  system: 'text-data',
};
