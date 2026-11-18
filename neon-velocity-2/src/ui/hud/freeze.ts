/**
 * Заморозка HUD под паузой. Бесконечные CSS-анимации останавливает правило
 * [data-frozen] в hud.css, а здесь — всё остальное, что живёт в Web Animations:
 * вспышки в долю (pulse.ts), анимации Framer Motion (прозрачность, фильтры) и
 * CSS-переходы. Под размытым экраном паузы не должно двигаться ничего: любое
 * изменение под ним заставляет браузер заново размывать весь кадр.
 */

/** Узел, у которого можно спросить анимации поддерева (Element). */
export interface AnimatedRoot {
  getAnimations(options?: GetAnimationsOptions): Animation[];
}

/** CSS-анимация: её ставит на паузу правило [data-frozen], а не скрипт. */
function isCssAnimation(animation: Animation): boolean {
  return typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation;
}

/**
 * Поставить на паузу идущие анимации поддерева. Возвращает функцию «продолжить»:
 * она запускает только те анимации, что всё ещё стоят на паузе — отменённые и
 * завершённые за это время (их снял Framer или размонтирование) не оживают.
 */
export function freezeAnimations(root: AnimatedRoot): () => void {
  const held: Animation[] = [];
  for (const animation of root.getAnimations({ subtree: true })) {
    if (animation.playState !== 'running' || isCssAnimation(animation)) continue;
    animation.pause();
    held.push(animation);
  }
  return () => {
    for (const animation of held) {
      if (animation.playState === 'paused') animation.play();
    }
    held.length = 0;
  };
}
