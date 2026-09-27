/** FactoryScript lexer: Python-like, indentation-sensitive (INDENT/DEDENT tokens). */
export type TokType = 'name' | 'num' | 'str' | 'op' | 'kw' | 'newline' | 'indent' | 'dedent' | 'eof' | 'comment';

export interface Token {
  t: TokType;
  v: string;
  line: number;
  col: number;
}

export class ScriptError extends Error {
  line: number;
  col: number;
  kind: 'syntax' | 'runtime' | 'budget';
  constructor(message: string, line: number, col = 0, kind: 'syntax' | 'runtime' | 'budget' = 'syntax') {
    super(message);
    this.line = line;
    this.col = col;
    this.kind = kind;
  }
}

export const KEYWORDS = new Set([
  'class', 'def', 'if', 'elif', 'else', 'for', 'in', 'while', 'return', 'and', 'or', 'not', 'True', 'False', 'None', 'pass', 'break', 'continue', 'is',
]);

const OPS3 = ['//='];
const OPS2 = ['==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '//', '**', '->'];
const OPS1 = '()[]{},:.=<>+-*/%';

/**
 * Tokenize source. With `keepComments` the comment tokens are emitted too (for syntax highlighting),
 * and errors are swallowed (tolerant mode).
 */
export function tokenize(src: string, keepComments = false): Token[] {
  const out: Token[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const indents = [0];
  let depth = 0; // bracket nesting → implicit line joining
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln].replace(/\t/g, '    ');
    const lineNo = ln + 1;
    let i = 0;
    // indentation (only at logical line start)
    if (depth === 0) {
      let spaces = 0;
      while (i < raw.length && raw[i] === ' ') {
        spaces++;
        i++;
      }
      const rest = raw.slice(i);
      if (rest === '' || rest.startsWith('#')) {
        if (keepComments && rest.startsWith('#')) out.push({ t: 'comment', v: rest, line: lineNo, col: i });
        continue; // blank or comment-only line
      }
      const cur = indents[indents.length - 1];
      if (spaces > cur) {
        indents.push(spaces);
        out.push({ t: 'indent', v: '', line: lineNo, col: 0 });
      } else if (spaces < cur) {
        while (indents.length && spaces < indents[indents.length - 1]) {
          indents.pop();
          out.push({ t: 'dedent', v: '', line: lineNo, col: 0 });
        }
        if (spaces !== indents[indents.length - 1]) {
          if (!keepComments) throw new ScriptError('Неверный отступ: уровень не совпадает ни с одним из внешних блоков', lineNo, spaces);
          indents.push(spaces);
        }
      }
    }
    while (i < raw.length) {
      const c = raw[i];
      if (c === ' ') {
        i++;
        continue;
      }
      if (c === '#') {
        if (keepComments) out.push({ t: 'comment', v: raw.slice(i), line: lineNo, col: i });
        break;
      }
      const col = i;
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(raw[i + 1] ?? ''))) {
        let j = i;
        while (j < raw.length && /[0-9_]/.test(raw[j])) j++;
        if (raw[j] === '.' && /[0-9]/.test(raw[j + 1] ?? '')) {
          j++;
          while (j < raw.length && /[0-9_]/.test(raw[j])) j++;
        } else if (raw[j] === '.' && !/[a-zA-Z_]/.test(raw[j + 1] ?? '')) j++;
        if (raw[j] === '%' && !/[A-Za-z0-9_(]/.test(raw[j + 1] ?? '')) {
          // 30% → 0.3 (convenience for vibe code)
          out.push({ t: 'num', v: String(Number(raw.slice(i, j).replace(/_/g, '')) / 100), line: lineNo, col });
          i = j + 1;
          continue;
        }
        out.push({ t: 'num', v: raw.slice(i, j).replace(/_/g, ''), line: lineNo, col });
        i = j;
        continue;
      }
      if (/[A-Za-z_Ѐ-ӿ]/.test(c)) {
        let j = i;
        while (j < raw.length && /[A-Za-z0-9_Ѐ-ӿ]/.test(raw[j])) j++;
        const w = raw.slice(i, j);
        out.push({ t: KEYWORDS.has(w) ? 'kw' : 'name', v: w, line: lineNo, col });
        i = j;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        let s = '';
        let closed = false;
        while (j < raw.length) {
          const d = raw[j];
          if (d === '\\' && j + 1 < raw.length) {
            const e = raw[j + 1];
            s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
            j += 2;
            continue;
          }
          if (d === c) {
            closed = true;
            j++;
            break;
          }
          s += d;
          j++;
        }
        if (!closed && !keepComments) throw new ScriptError('Незакрытая строка', lineNo, col);
        out.push({ t: 'str', v: s, line: lineNo, col });
        i = j;
        continue;
      }
      const three = raw.slice(i, i + 3);
      const two = raw.slice(i, i + 2);
      if (OPS3.includes(three)) {
        out.push({ t: 'op', v: three, line: lineNo, col });
        i += 3;
        continue;
      }
      if (OPS2.includes(two)) {
        out.push({ t: 'op', v: two, line: lineNo, col });
        i += 2;
        continue;
      }
      if (OPS1.includes(c)) {
        if (c === '(' || c === '[' || c === '{') depth++;
        if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        out.push({ t: 'op', v: c, line: lineNo, col });
        i++;
        continue;
      }
      if (!keepComments) throw new ScriptError(`Неожиданный символ «${c}»`, lineNo, col);
      i++;
    }
    if (depth === 0 && out.length && out[out.length - 1].t !== 'newline' && out[out.length - 1].t !== 'comment') {
      out.push({ t: 'newline', v: '', line: lineNo, col: raw.length });
    }
  }
  if (depth > 0 && !keepComments) throw new ScriptError('Незакрытая скобка', lines.length, 0);
  const last = lines.length;
  while (indents.length > 1) {
    indents.pop();
    out.push({ t: 'dedent', v: '', line: last, col: 0 });
  }
  out.push({ t: 'eof', v: '', line: last, col: 0 });
  return out;
}
