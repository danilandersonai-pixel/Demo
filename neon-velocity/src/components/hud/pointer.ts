/** Основной ввод — палец: у устройства нет ни мыши, ни тачпада. */
export function isCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}
