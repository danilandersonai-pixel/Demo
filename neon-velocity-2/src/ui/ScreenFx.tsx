export interface ScreenFxProps {
  /**
   * Спокойный режим — пауза, Game Over, открытая панель: бегущая полоса ЭЛТ
   * убирается, на экране не остаётся ничего, что двигалось бы само.
   */
  calm: boolean;
}

/** Эффекты «экрана автомата» поверх всего (слой z-50): виньетка, сканлайны, бегущая полоса. */
export function ScreenFx({ calm }: ScreenFxProps) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div className="nv-vignette absolute inset-0" />
      <div className="nv-scanlines absolute inset-0" />
      {!calm && <div className="nv-scanbar absolute inset-x-0 top-0 h-[18vh] animate-scan" />}
    </div>
  );
}
