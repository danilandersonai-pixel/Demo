/**
 * Эффекты «экрана аркадного автомата» поверх всего (слой z-50): сканлайны,
 * виньетка и медленная полоса развёртки. Рендер запекает в фон лишь лёгкое
 * затемнение краёв, основная виньетка — здесь; сканлайны и полоса нарочно едва
 * заметны. Указатель проходит насквозь.
 */
export function ScreenFx() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div className="nv-scanlines absolute inset-0 opacity-70" />
      <div className="nv-vignette absolute inset-0 opacity-70" />
      <div className="nv-scanbar absolute inset-x-0 top-0 h-[22vh] animate-scan" />
    </div>
  );
}
