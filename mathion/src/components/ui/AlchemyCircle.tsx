/** Декоративный алхимический круг: концентрические кольца, треугольник стихий и руны-цифры. */
export function AlchemyCircle({ className = '' }: { className?: string }) {
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'π', 'x'];
  return (
    <svg viewBox="0 0 400 400" className={className} aria-hidden="true" fill="none">
      <circle cx="200" cy="200" r="190" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="200" cy="200" r="172" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 6" />
      <circle cx="200" cy="200" r="120" stroke="currentColor" strokeWidth="1" />
      <circle cx="200" cy="200" r="60" stroke="currentColor" strokeWidth="1" />
      <path d="M200 30 L347 285 L53 285 Z" stroke="currentColor" strokeWidth="1" />
      <path d="M200 370 L53 115 L347 115 Z" stroke="currentColor" strokeWidth="0.8" />
      <path d="M200 80 L200 320 M80 200 L320 200" stroke="currentColor" strokeWidth="0.6" />
      {digits.map((digit, i) => {
        const angle = (i / digits.length) * Math.PI * 2 - Math.PI / 2;
        const x = 200 + Math.cos(angle) * 181;
        const y = 200 + Math.sin(angle) * 181 + 4;
        return (
          <text key={digit} x={x} y={y} textAnchor="middle" fontSize="12" fill="currentColor" fontFamily="serif">
            {digit}
          </text>
        );
      })}
    </svg>
  );
}
