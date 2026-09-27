import type { DiffLine } from '../vibe/git';

const KW = new Set(['class', 'def', 'if', 'elif', 'else', 'for', 'in', 'while', 'return', 'and', 'or', 'not', 'True', 'False', 'None', 'pass', 'break', 'continue', 'is']);
const API = new Set(['disable', 'enable', 'shutdown', 'set_priority', 'route', 'balance', 'set_recipe', 'limit', 'notify', 'dispatch', 'build', 'log', 'stock', 'rate', 'buildings', 'count', 'consumption']);
const TOKEN = /(#.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(\b\d+(?:\.\d+)?%?)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\s+)|(.)/g;

/** Lightweight line highlighter for FactoryScript (display only). */
export function HighlightLine({ text }: { text: string }) {
  const out: any[] = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(TOKEN.source, 'g');
  let i = 0;
  let prevWord = '';
  while ((m = rx.exec(text))) {
    const [tok, com, str, num, word] = m;
    if (com) out.push(<span class="c-com" key={i++}>{tok}</span>);
    else if (str) out.push(<span class="c-str" key={i++}>{tok}</span>);
    else if (num) out.push(<span class="c-num" key={i++}>{tok}</span>);
    else if (word) {
      const after = text.slice(rx.lastIndex).trimStart();
      let cls = 'c-name';
      if (KW.has(word)) cls = 'c-kw';
      else if (word === 'self') cls = 'c-self';
      else if (prevWord === 'class') cls = 'c-cls';
      else if (word === 'Agent') cls = 'c-cls';
      else if (after.startsWith('(')) cls = API.has(word) ? 'c-api' : 'c-fn';
      out.push(<span class={cls} key={i++}>{tok}</span>);
      prevWord = word;
    } else out.push(tok);
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return <>{out}</>;
}

export function CodeView({ code, errorLine, maxHeight = 360 }: { code: string; errorLine?: number; maxHeight?: number }) {
  const lines = code.replace(/\n$/, '').split('\n');
  return (
    <div class="code scroll" style={{ maxHeight }}>
      {lines.map((l, i) => (
        <div class={'cl' + (errorLine === i + 1 ? ' err' : '')} key={i}>
          <span class="ln">{i + 1}</span>
          <span class="lt"><HighlightLine text={l} /></span>
        </div>
      ))}
    </div>
  );
}

export function DiffView({ diff, maxHeight = 360 }: { diff: DiffLine[]; maxHeight?: number }) {
  return (
    <div class="code scroll" style={{ maxHeight }}>
      {diff.map((d, i) => (
        <div class={'cl ' + (d.op === '+' ? 'add' : d.op === '-' ? 'del' : '')} key={i}>
          <span class="ln">{d.op === '-' ? d.a : d.b ?? ''}</span>
          <span class="op">{d.op === ' ' ? ' ' : d.op}</span>
          <span class="lt"><HighlightLine text={d.text} /></span>
        </div>
      ))}
    </div>
  );
}
