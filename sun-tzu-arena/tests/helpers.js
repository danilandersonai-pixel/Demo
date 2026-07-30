// Вспомогательные фабрики для тестов (сам файл тестов не содержит).

/**
 * Стратегия, играющая заданную последовательность ходов по номеру раунда;
 * после конца сценария — fallback.
 */
export function scripted(moves, fallback = 'C', id = 'scripted') {
  return {
    id,
    name: id,
    create() {
      return {
        move(mine) {
          const r = mine.length;
          return r < moves.length ? moves[r] : fallback;
        },
      };
    },
  };
}

/** ГПСЧ-заглушка, всегда возвращающая одно и то же значение. */
export function constRng(value) {
  return () => value;
}
