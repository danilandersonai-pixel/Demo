import { padScore } from '../ui/format';

export interface ScoreDigitsProps {
  value: number;
  /** Сколько знаков с ведущими нулями. */
  width?: number;
  className?: string;
  /** Классы значащих цифр (цвет, свечение). */
  digitsClassName?: string;
  /** Классы приглушённых ведущих нулей. */
  leadClassName?: string;
}

/** Аркадный счёт: ведущие нули приглушены, значащие цифры светятся. */
export function ScoreDigits({
  value,
  width = 7,
  className = '',
  digitsClassName = 'text-ink',
  leadClassName = 'text-ink-faint/45',
}: ScoreDigitsProps) {
  const { lead, digits } = padScore(value, width);
  return (
    <span className={['nv-digits inline-flex font-mono', className].join(' ')}>
      {lead && <span className={leadClassName}>{lead}</span>}
      <span className={digitsClassName}>{digits}</span>
    </span>
  );
}
