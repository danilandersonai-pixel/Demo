export interface ScreenFxProps {
  /**
   * Открыт экран поверх сцены (пауза, итоги, панель): бегущая полоса
   * снимается. Она едва заметна, но, двигаясь над стеклом карточки
   * (backdrop-filter), заставляла бы браузер каждый кадр заново размывать фон.
   */
  calm?: boolean;
}

/**
 * Эффекты «экрана аркадного автомата» поверх всего (слой z-50): сканлайны,
 * виньетка и медленная полоса развёртки. Рендер запекает в фон лишь лёгкое
 * затемнение краёв, основная виньетка — здесь; сканлайны и полоса нарочно едва
 * заметны. Указатель проходит насквозь.
 */
export function ScreenFx({ calm = false }: ScreenFxProps) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div className="nv-scanlines absolute inset-0 opacity-70" />
      <div className="nv-vignette absolute inset-0 opacity-70" />
      {!calm && <div className="nv-scanbar absolute inset-x-0 top-0 h-[22vh] animate-scan" />}
    </div>
  );
}
