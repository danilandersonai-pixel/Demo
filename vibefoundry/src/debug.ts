import type { Game } from './game';
import type { BuildingType } from './data/buildings';
import type { Dir } from './core/iso';
import { TECHS } from './data/research';
import { buildStress } from './stress';

/** Debug API for automated playtests (window.__vf). Not used by gameplay. */
export function installDebugApi(game: Game): void {
  const api = {
    game,
    ready: true,
    get sim() {
      return game.sim;
    },
    stress() {
      const c = buildStress(game.sim);
      game.sim.run(1);
      return c;
    },
    /** Average ms per rendered frame (sim step + renderer update + GPU submit). */
    measure(frames = 120) {
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        game.sim.step();
        game.renderer.render(0.5, 1 / 60);
        game.app.renderer.render(game.app.stage);
      }
      const ms = (performance.now() - t0) / frames;
      return { msPerFrame: Math.round(ms * 100) / 100, fps: Math.round(1000 / ms) };
    },
    demo() {
      game.startDemo();
      return true;
    },
    newGame(seed = 20260926, peaceful = false) {
      game.newGame({ seed, peaceful });
      return true;
    },
    /** Run the simulation synchronously for N game seconds. */
    run(seconds: number) {
      game.sim.run(seconds);
      return game.sim.tick;
    },
    /** Render N frames synchronously (for hidden tabs / screenshots). */
    frame(n = 1) {
      for (let i = 0; i < n; i++) {
        game.renderer.render(0, 1 / 60);
        game.app.renderer.render(game.app.stage);
      }
      return true;
    },
    base() {
      return { ...game.sim.world.base };
    },
    place(type: BuildingType, x: number, y: number, dir: Dir = 1, recipe?: string, instant = false) {
      const e = game.sim.place(type, x, y, dir, { recipe, instant });
      return e ? e.id : null;
    },
    give(items: Record<string, number>) {
      for (const k in items) game.sim.addStock(k, items[k]);
      return true;
    },
    research(id: string) {
      game.sim.research.current = id;
      return !!TECHS[id];
    },
    completeResearch(ids: string[]) {
      for (const id of ids) game.sim.completeResearch(id);
      return game.sim.research.done.length;
    },
    camera(x: number, y: number, zoom = 1) {
      game.renderer.flyTo(x, y, zoom);
      game.renderer.cam.x = game.renderer.cam.tx;
      game.renderer.cam.y = game.renderer.cam.ty;
      game.renderer.cam.zoom = zoom;
      return true;
    },
    panel(p: any) {
      game.ui.panel = p;
      game.emit();
      return true;
    },
    setTime(frac: number) {
      game.sim.dayTime = frac * 480;
      return true;
    },
    state() {
      const s = game.sim;
      return {
        tick: s.tick,
        time: s.time,
        era: s.ai.era,
        entities: s.list.length,
        ghosts: s.list.filter((e) => e.ghost).length,
        research: s.research.done.slice(),
        current: s.research.current,
        quests: s.quests.done.slice(),
        stock: s.stockAll(),
        produced: { ...s.stats.totalProduced },
        tokens: Math.round(s.ai.tokens),
        compute: Math.round(s.ai.compute),
        commits: s.git.commits.length,
        agents: s.ai.agents.map((a) => a.role),
      };
    },
  };
  (window as any).__vf = api;
}
