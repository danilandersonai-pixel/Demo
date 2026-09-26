import type { Sim } from '../sim/sim';

/** Placeholder runtime (replaced in phase 4 with the FactoryScript interpreter). */
export class ScriptRuntime {
  invalidate(): void {}
  update(_sim: Sim, _dt: number): void {}
  loadFromGit(_sim: Sim): void {}
  exportState(): Record<string, Record<string, any>> {
    return {};
  }
  importState(_s: Record<string, Record<string, any>>): void {}
}
