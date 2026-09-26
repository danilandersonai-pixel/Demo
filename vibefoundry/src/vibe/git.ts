/** Factory Git: commits of automation config (scripts + groups + priorities), tags, rollback. */
export type CommitTag = 'base' | 'ai' | 'fix' | 'catastrophe' | 'refactor' | 'rollback' | 'manual' | null;

export interface Commit {
  id: number;
  version: string;
  message: string;
  author: string;
  time: number;
  files: Record<string, string>;
  groups: Record<string, number[]>;
  priorities: Record<number, number>;
  tag: CommitTag;
  parent: number | null;
  /** Production score (items/min) at commit time, for catastrophe detection. */
  prodBefore: number;
  checkAt?: number;
  /** Optional full factory snapshot (costs memory). */
  snapshot?: any;
  branch: string;
  techDebtAdded?: number;
}

export interface GitState {
  commits: Commit[];
  head: number | null;
  nextId: number;
  minor: number;
}

export function newGitState(): GitState {
  return { commits: [], head: null, nextId: 1, minor: 0 };
}

export function headCommit(g: GitState): Commit | undefined {
  return g.commits.find((c) => c.id === g.head);
}

export function headFiles(g: GitState): Record<string, string> {
  return headCommit(g)?.files ?? {};
}

export const TAG_LABELS: Record<Exclude<CommitTag, null>, string> = {
  base: 'Базовая версия',
  ai: 'AI-оптимизация',
  fix: 'Исправление бага',
  catastrophe: 'Катастрофа',
  refactor: 'Рефакторинг',
  rollback: 'Откат',
  manual: 'Ручная правка',
};

export function nextVersion(g: GitState): string {
  const v = `v1.${g.minor}`;
  return v;
}

export function commit(
  g: GitState,
  data: Omit<Commit, 'id' | 'version' | 'parent' | 'branch'> & { branch?: string },
): Commit {
  const c: Commit = {
    ...data,
    id: g.nextId++,
    version: nextVersion(g),
    parent: g.head,
    branch: data.branch ?? 'main',
  };
  g.minor++;
  g.commits.push(c);
  g.head = c.id;
  return c;
}

// ------------------------------------------------------------------ diff
export interface DiffLine {
  op: ' ' | '+' | '-';
  text: string;
  a?: number;
  b?: number;
}

/** Line diff via LCS (fine for scripts of a few hundred lines). */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a ? a.split('\n') : [];
  const B = b ? b.split('\n') : [];
  const n = A.length;
  const m = B.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ op: ' ', text: A[i], a: i + 1, b: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: '-', text: A[i], a: i + 1 });
      i++;
    } else {
      out.push({ op: '+', text: B[j], b: j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ op: '-', text: A[i], a: ++i });
  while (j < m) out.push({ op: '+', text: B[j], b: ++j });
  return out;
}

export function diffStat(d: DiffLine[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const l of d) {
    if (l.op === '+') add++;
    else if (l.op === '-') del++;
  }
  return { add, del };
}

export function allFilesText(files: Record<string, string>): string {
  return Object.keys(files)
    .sort()
    .map((k) => `# ${k}\n${files[k]}`)
    .join('\n\n');
}
