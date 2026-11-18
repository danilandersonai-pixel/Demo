import { padScore } from '../kit/format';

export interface ScoreDigitsProps {
  value: number;
  /** До скольких знаков дополнять нулями. */
  width?: number;
  className?: string;
}

/** Аркадный счёт: ведущие нули приглушены, значащие цифры яркие. */
export function ScoreDigits({ value, width = 7, className = '' }: ScoreDigitsProps) {
  const { lead, digits } = padScore(value, width);
  return (
    <span className={`nvh-digits font-mono ${className}`} data-long={digits.length > width || undefined}>
      {lead && <span className="text-ink-faint/60 [text-shadow:none]">{lead}</span>}
      {digits}
    </span>
  );
}
