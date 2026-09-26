import type { Sim } from '../sim/sim';
import { parse } from '../script/parser';
import { mainPower } from '../sim/power';
import { headFiles } from './git';
import { BUILDINGS } from '../data/buildings';
import { RECIPES } from '../data/recipes';
import { ITEMS, type ItemId } from '../data/items';
import { ERA_NAMES } from '../ai/eras';

/** Optional "Real AI" mode: Claude via the Anthropic Messages API, called directly from the browser. */
export const LLM_MODELS: { id: string; name: string }[] = [
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 — быстрая и дешёвая' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5 — баланс' },
  { id: 'claude-opus-5', name: 'Claude Opus 5 — самая умная' },
];

const KEY_STORAGE = 'vf-anthropic-key';
const MODEL_STORAGE = 'vf-anthropic-model';
const ENABLED_STORAGE = 'vf-anthropic-enabled';

/** The key lives only in this browser's localStorage. It is never written to saves, logs or chat. */
export const llmSettings = {
  get key(): string {
    try {
      return localStorage.getItem(KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  },
  set key(v: string) {
    try {
      if (v) localStorage.setItem(KEY_STORAGE, v);
      else localStorage.removeItem(KEY_STORAGE);
    } catch {
      /* storage blocked */
    }
  },
  get model(): string {
    try {
      return localStorage.getItem(MODEL_STORAGE) ?? LLM_MODELS[0].id;
    } catch {
      return LLM_MODELS[0].id;
    }
  },
  set model(v: string) {
    try {
      localStorage.setItem(MODEL_STORAGE, v);
    } catch {
      /* storage blocked */
    }
  },
  get enabled(): boolean {
    try {
      return localStorage.getItem(ENABLED_STORAGE) === '1';
    } catch {
      return false;
    }
  },
  set enabled(v: boolean) {
    try {
      localStorage.setItem(ENABLED_STORAGE, v ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  },
};

export const GRAMMAR = `FactoryScript — Python-like language for factory agents.
Top level: only classes "class Name(Agent):". Class body: fields ("every = 2" seconds between runs, default 1; other fields are defaults for self attributes) and methods.
Methods: def run(self), def monitor(self) (both called every run), def on_event(self, name) (events: "low_energy").
Statements: if/elif/else, for x in <list>, while (operation budget 500 per run), return, pass, break, continue, assignment (=, +=, -=), self.attr = value (persists between runs).
Expressions: numbers, "strings", True/False/None, lists, dicts, + - * / // % **, comparisons (chains allowed), and/or/not, in/not in, "a if c else b", 30% == 0.3.
Builtins: len, min, max, sum, abs, round, int, str, range.
Sensors (read-only): self.power / self.energy (0..1 power supply ratio), self.time (s), self.is_night, self.day, self.alerts (list: "low_energy","enemies","starved","blocked").
Queries: self.stock("item"), self.rate("item") (produced per minute), self.consumption("item"), self.buildings("group") (list; building attrs: type, name, status, working, idle, enabled, powered, recipe, x, y), self.count("building_type").
Actions: self.enable(g), self.disable(g), self.shutdown(g) (g = group name, building, or list; effects last while the script keeps calling them), self.set_priority(g_or_item, 1..5) (1 = powered first), self.route(item, group) (splitter filters), self.balance(item), self.set_recipe(group, item), self.limit(item, max) (stop crafting when stock >= max), self.notify(text, level) (levels info/warning/danger/success; text "low_energy" is a preset), self.dispatch(drone, target) (("scout","nearest_unknown"), ("combat","enemies")), self.build(blueprint, near) (e.g. "microchip_line"), self.log(...).
Groups: explicit player groups; building types (smelter, assembler, assembler2, chem, drills, labs, servers, datacenter, inference, training, radars, turrets, pumpjack, power_plant, solar); "<item>_production" (e.g. chip_production, battery_production); "<item>_smelters" (iron_smelters); "<ore>_mining" (copper_mining); "all".
Item ids: ${Object.keys(ITEMS).join(', ')}. Aliases: chips, batteries, gears, wires, plastic, steel, wafers.`;

export function factorySummary(sim: Sim): string {
  const net = mainPower(sim);
  const types: Record<string, number> = {};
  const recipes: Record<string, number> = {};
  for (const e of sim.list) {
    if (e.ghost || e.type === 'belt' || e.type === 'pipe' || e.type === 'pole') continue;
    types[e.type] = (types[e.type] ?? 0) + 1;
    if (e.recipe && RECIPES[e.recipe]) recipes[e.recipe] = (recipes[e.recipe] ?? 0) + 1;
  }
  const rates = sim.stats.keys
    .filter((k) => k in ITEMS)
    .map((k) => [k, sim.stats.rate(k)] as [string, number])
    .filter(([, r]) => r > 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, r]) => `${k} ${Math.round(r)}/min`);
  const stock = Object.entries(sim.stockAll())
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, n]) => `${k} ${n}`);
  const files = headFiles(sim.git);
  return [
    `Era: ${sim.ai.era} (${ERA_NAMES[sim.ai.era]}). Time: ${Math.floor(sim.time)} s, ${sim.isNight ? 'night' : 'day'}.`,
    `Power: capacity ${Math.round(net.capacity)} kW, demand ${Math.round(net.demand)} kW, satisfaction ${Math.round(net.sat * 100)}%.`,
    `Buildings: ${Object.entries(types).map(([k, n]) => `${BUILDINGS[k as keyof typeof BUILDINGS]?.id ?? k}×${n}`).join(', ') || 'none'}.`,
    `Recipes in use: ${Object.entries(recipes).map(([k, n]) => `${k}×${n}`).join(', ') || 'none'}.`,
    `Production: ${rates.join(', ') || 'none'}.`,
    `Stock: ${stock.join(', ') || 'empty'}.`,
    `Player groups: ${Object.keys(sim.groups).join(', ') || 'none'}.`,
    Object.keys(files).length ? `Current scripts:\n${Object.entries(files).map(([f, s]) => `# ${f}\n${s}`).join('\n')}` : 'No scripts yet.',
  ].join('\n');
}

function extractCode(text: string): string {
  const m = text.match(/```(?:python|py|factoryscript)?\s*\n([\s\S]*?)```/);
  const code = (m ? m[1] : text).replace(/\r\n?/g, '\n').trim();
  return code + '\n';
}

export interface LlmResult {
  code: string;
  model: string;
  fixed: boolean;
}

/**
 * Ask Claude for FactoryScript. The answer must pass our parser; on a parse error we make exactly one
 * self-correction round, then give up (the caller falls back to the offline engine).
 */
export async function llmGenerate(sim: Sim, request: string, apiKey: string, model: string): Promise<LlmResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 });
  const system = `You write automation code for the factory game VibeFoundry.\n\n${GRAMMAR}\n\nFactory state:\n${factorySummary(sim)}\n\nAnswer with a single \`\`\`python code block containing only FactoryScript classes. Prefer one or two small agent classes. Use group names that resolve (see Groups).`;
  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: request }];
  const opus = model === 'claude-opus-5';
  const call = async () => {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      system,
      messages,
      ...(opus ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (res.stop_reason === 'refusal') throw new Error('модель отказалась выполнять запрос');
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  };
  const first = await call();
  let code = extractCode(first);
  try {
    parse(code);
    return { code, model, fixed: false };
  } catch (e) {
    messages.push({ role: 'assistant', content: first });
    messages.push({ role: 'user', content: `The FactoryScript parser rejected this code: ${(e as Error).message} (line ${(e as any).line ?? '?'}). Return the corrected code block only.` });
  }
  const second = await call();
  code = extractCode(second);
  parse(code); // throws → caller falls back
  return { code, model, fixed: true };
}

/** Human-readable error without ever echoing the key. */
export function llmErrorText(e: unknown): string {
  const err = e as { status?: number; message?: string; name?: string };
  if (err?.status === 401) return 'неверный API-ключ';
  if (err?.status === 429) return 'превышен лимит запросов';
  if (err?.status === 400) return 'запрос отклонён API';
  if (err?.status && err.status >= 500) return 'сервер Anthropic недоступен';
  if (err?.name === 'APIConnectionError' || /fetch|network|connection/i.test(err?.message ?? '')) return 'нет соединения с API';
  return (err?.message ?? 'ошибка').replace(/sk-ant-[A-Za-z0-9_-]+/g, '***');
}

export function summarizeItem(id: string): string {
  return ITEMS[id as ItemId]?.name ?? id;
}

/** Minimal request to validate the key and model. */
export async function llmPing(apiKey: string, model: string): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 30_000 });
  const res = await client.messages.create({ model, max_tokens: 32, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] });
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}
