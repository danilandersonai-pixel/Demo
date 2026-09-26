/** Serializable state of the AI layer: resources, agents, chats, proposals, eras. */
export type AgentRole = 'terminal' | 'architect' | 'coder' | 'debugger' | 'optimizer' | 'orchestrator';

export interface AgentTask {
  kind: 'code' | 'plan' | 'scan' | 'refactor' | 'fix' | 'orchestrate' | 'blueprint' | 'answer';
  label: string;
  progress: number;
  duration: number;
  /** Payload understood by the vibe controller when the task completes. */
  payload?: any;
}

export interface Agent {
  id: number;
  role: AgentRole;
  name: string;
  level: number;
  xp: number;
  speed: number;
  status: 'idle' | 'working' | 'error';
  task?: AgentTask;
  hiredAt: number;
  done: number;
}

export interface ChatOption {
  label: string;
  text: string;
}

export interface ChatMsg {
  id: number;
  from: 'player' | 'agent' | 'system';
  agentId?: number;
  role?: AgentRole;
  text: string;
  time: number;
  proposalId?: number;
  options?: ChatOption[];
  checklist?: string[];
  steps?: { role: AgentRole; text: string; done: boolean }[];
}

export interface BugRecord {
  type: 'wrong_item' | 'inverted' | 'flapping' | 'bad_group' | 'missing_else';
  line: number;
  desc: string;
  /** Source before corruption (used by Debugger to propose the fix). */
  original: string;
  found?: boolean;
}

export interface Forecast {
  seconds: number;
  rows: { key: string; label: string; before: number; after: number; unit: string }[];
  powerBefore: number;
  powerAfter: number;
  tests?: { name: string; pass: boolean }[];
  summary: string;
}

export interface Proposal {
  id: number;
  agentId: number;
  role: AgentRole;
  request: string;
  kind: 'script' | 'blueprint' | 'refactor' | 'fix';
  fileName: string;
  code: string;
  prevCode: string;
  tokens: number;
  confidence: number;
  checklist: string[];
  status: 'pending' | 'accepted' | 'rejected' | 'sandbox';
  bugs: BugRecord[];
  forecast?: Forecast;
  /** Blueprint proposal payload (Architect). */
  blueprint?: { item: string; rate: number; machines: number; entities: { type: string; dx: number; dy: number; dir: number; recipe?: string }[] };
  message: string;
  tag?: 'ai' | 'fix' | 'base' | 'refactor';
  sandboxed?: boolean;
  edited?: boolean;
  createdAt: number;
}

export interface CiTest {
  id: number;
  name: string;
  kind: 'rate_ge' | 'power_ge' | 'stock_ge';
  key: string;
  value: number;
  pass: boolean;
  /** For power_ge: whether it ever failed since creation ("never below"). */
  everFailed?: boolean;
}

export interface AIState {
  era: number;
  compute: number;
  tokens: number;
  data: number;
  weights: number;
  weightsTotal: number;
  techDebt: number;
  agents: Agent[];
  nextAgentId: number;
  chat: ChatMsg[];
  nextMsgId: number;
  proposals: Proposal[];
  nextProposalId: number;
  ciTests: CiTest[];
  nextTestId: number;
  autonomy: number;
  autonomyHeld: number;
  manualActions: number[];
  victory: boolean;
  victoryShown: boolean;
  eraTimes: number[];
  orchestratorGoalAt: number;
  lastDebuggerScan: number;
  llm: { enabled: boolean; model: string };
  /** Recent flap counters for Debugger (entity id → toggles in the last minute). */
  bugHistory: { time: number; text: string }[];
}

export function newAIState(): AIState {
  return {
    era: 1,
    compute: 120,
    tokens: 600,
    data: 0,
    weights: 0,
    weightsTotal: 0,
    techDebt: 0,
    agents: [
      { id: 1, role: 'terminal', name: 'Терминал', level: 1, xp: 0, speed: 1, status: 'idle', hiredAt: 0, done: 0 },
    ],
    nextAgentId: 2,
    chat: [],
    nextMsgId: 1,
    proposals: [],
    nextProposalId: 1,
    ciTests: [],
    nextTestId: 1,
    autonomy: 0,
    autonomyHeld: 0,
    manualActions: [],
    victory: false,
    victoryShown: false,
    eraTimes: [0],
    orchestratorGoalAt: 0,
    lastDebuggerScan: 0,
    llm: { enabled: false, model: 'claude-haiku-4-5-20251001' },
    bugHistory: [],
  };
}

export function modelVersion(ai: AIState): number {
  return Math.min(4, 1 + ai.weightsTotal / 20);
}

export function modelVersionLabel(ai: AIState): string {
  const v = modelVersion(ai);
  return `v${Math.floor(v)}.${Math.floor((v - Math.floor(v)) * 10)}`;
}
