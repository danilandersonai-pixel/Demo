import { tokenize, ScriptError, type Token } from './lexer';
import type { ClassDef, Expr, FuncDef, Program, Stmt } from './ast';

/** Recursive-descent parser for FactoryScript. */
export class Parser {
  private toks: Token[];
  private p = 0;

  constructor(src: string) {
    this.toks = tokenize(src);
  }

  private peek(o = 0): Token {
    return this.toks[Math.min(this.p + o, this.toks.length - 1)];
  }
  private next(): Token {
    return this.toks[this.p++];
  }
  private is(t: Token['t'], v?: string): boolean {
    const k = this.peek();
    return k.t === t && (v === undefined || k.v === v);
  }
  private accept(t: Token['t'], v?: string): Token | null {
    if (this.is(t, v)) return this.next();
    return null;
  }
  private expect(t: Token['t'], v: string | undefined, msg: string): Token {
    const k = this.peek();
    if (k.t === t && (v === undefined || k.v === v)) return this.next();
    throw new ScriptError(msg + (k.t === 'eof' ? ' (конец файла)' : k.v ? `, а встретилось «${k.v}»` : ''), k.line, k.col);
  }

  parseProgram(): Program {
    const classes: ClassDef[] = [];
    while (!this.is('eof')) {
      if (this.accept('newline')) continue;
      if (this.is('kw', 'class')) {
        classes.push(this.parseClass());
        continue;
      }
      if (this.accept('kw', 'pass')) continue;
      const k = this.peek();
      throw new ScriptError('На верхнем уровне допускаются только классы-агенты: class Name(Agent):', k.line, k.col);
    }
    return { classes };
  }

  private parseClass(): ClassDef {
    const kw = this.next();
    const name = this.expect('name', undefined, 'Ожидалось имя класса').v;
    let base: string | null = null;
    if (this.accept('op', '(')) {
      if (!this.is('op', ')')) base = this.expect('name', undefined, 'Ожидался базовый класс').v;
      this.expect('op', ')', 'Ожидалась «)»');
    }
    this.expect('op', ':', 'Ожидалось «:» после объявления класса');
    this.expect('newline', undefined, 'Ожидался перевод строки');
    this.expect('indent', undefined, 'Тело класса должно быть с отступом');
    const cls: ClassDef = { name, base, fields: [], methods: [], line: kw.line };
    while (!this.is('dedent') && !this.is('eof')) {
      if (this.accept('newline')) continue;
      if (this.accept('kw', 'pass')) continue;
      if (this.is('kw', 'def')) {
        cls.methods.push(this.parseDef());
        continue;
      }
      if (this.is('name') && this.peek(1).t === 'op' && this.peek(1).v === '=') {
        const n = this.next();
        this.next();
        const value = this.parseExpr();
        cls.fields.push({ name: n.v, value, line: n.line });
        this.accept('newline');
        continue;
      }
      const k = this.peek();
      throw new ScriptError('В теле класса ожидались поля (every = 2) или методы (def run(self):)', k.line, k.col);
    }
    this.accept('dedent');
    return cls;
  }

  private parseDef(): FuncDef {
    const kw = this.next();
    const name = this.expect('name', undefined, 'Ожидалось имя метода').v;
    this.expect('op', '(', 'Ожидалась «(»');
    const params: string[] = [];
    while (!this.is('op', ')')) {
      params.push(this.expect('name', undefined, 'Ожидалось имя параметра').v);
      if (!this.accept('op', ',')) break;
    }
    this.expect('op', ')', 'Ожидалась «)»');
    if (this.accept('op', '->')) this.parseExpr();
    this.expect('op', ':', 'Ожидалось «:» после объявления метода');
    const body = this.parseBlock();
    return { name, params, body, line: kw.line };
  }

  private parseBlock(): Stmt[] {
    if (!this.is('newline')) {
      // single-line body: if x: y
      const s = this.parseSimple();
      this.accept('newline');
      return [s];
    }
    this.expect('newline', undefined, 'Ожидался перевод строки');
    this.expect('indent', undefined, 'Ожидался блок с отступом');
    const out: Stmt[] = [];
    while (!this.is('dedent') && !this.is('eof')) {
      if (this.accept('newline')) continue;
      out.push(this.parseStmt());
    }
    this.accept('dedent');
    if (!out.length) out.push({ k: 'pass', line: this.peek().line });
    return out;
  }

  private parseStmt(): Stmt {
    const k = this.peek();
    if (k.t === 'kw') {
      switch (k.v) {
        case 'if':
          return this.parseIf();
        case 'for': {
          this.next();
          const target = this.expect('name', undefined, 'Ожидалась переменная цикла').v;
          this.expect('kw', 'in', 'Ожидалось «in»');
          const iter = this.parseExpr();
          this.expect('op', ':', 'Ожидалось «:»');
          return { k: 'for', target, iter, body: this.parseBlock(), line: k.line };
        }
        case 'while': {
          this.next();
          const test = this.parseExpr();
          this.expect('op', ':', 'Ожидалось «:»');
          return { k: 'while', test, body: this.parseBlock(), line: k.line };
        }
        case 'def':
          throw new ScriptError('Вложенные функции не поддерживаются — объявите метод в классе', k.line, k.col);
        case 'class':
          throw new ScriptError('Классы объявляются только на верхнем уровне', k.line, k.col);
      }
    }
    const s = this.parseSimple();
    if (!this.accept('newline') && !this.is('dedent') && !this.is('eof')) {
      const n = this.peek();
      throw new ScriptError(`Лишнее «${n.v}» в конце строки`, n.line, n.col);
    }
    return s;
  }

  private parseIf(): Stmt {
    const kw = this.next();
    const test = this.parseExpr();
    this.expect('op', ':', 'Ожидалось «:» после условия');
    const body = this.parseBlock();
    let orelse: Stmt[] = [];
    if (this.is('kw', 'elif')) {
      orelse = [this.parseIf()];
    } else if (this.accept('kw', 'else')) {
      this.expect('op', ':', 'Ожидалось «:» после else');
      orelse = this.parseBlock();
    }
    return { k: 'if', test, body, orelse, line: kw.line };
  }

  private parseSimple(): Stmt {
    const k = this.peek();
    if (this.accept('kw', 'pass')) return { k: 'pass', line: k.line };
    if (this.accept('kw', 'break')) return { k: 'break', line: k.line };
    if (this.accept('kw', 'continue')) return { k: 'continue', line: k.line };
    if (this.accept('kw', 'return')) {
      if (this.is('newline') || this.is('dedent') || this.is('eof')) return { k: 'return', e: null, line: k.line };
      return { k: 'return', e: this.parseExpr(), line: k.line };
    }
    const e = this.parseExpr();
    const op = this.peek();
    if (op.t === 'op' && ['=', '+=', '-=', '*=', '/='].includes(op.v)) {
      if (e.k !== 'name' && e.k !== 'attr' && e.k !== 'index') throw new ScriptError('Присваивать можно только переменной, атрибуту или элементу', op.line, op.col);
      this.next();
      const value = this.parseExpr();
      return { k: 'assign', target: e, op: op.v, value, line: k.line };
    }
    return { k: 'expr', e, line: k.line };
  }

  // ------------------------------------------------------------ expressions
  parseExpr(): Expr {
    const e = this.parseOr();
    if (this.is('kw', 'if')) {
      const line = this.next().line;
      const test = this.parseOr();
      this.expect('kw', 'else', 'Ожидалось «else» в условном выражении');
      const b = this.parseExpr();
      return { k: 'ternary', test, a: e, b, line };
    }
    return e;
  }
  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.is('kw', 'or')) {
      const t = this.next();
      l = { k: 'bool_op', op: 'or', l, r: this.parseAnd(), line: t.line };
    }
    return l;
  }
  private parseAnd(): Expr {
    let l = this.parseNot();
    while (this.is('kw', 'and')) {
      const t = this.next();
      l = { k: 'bool_op', op: 'and', l, r: this.parseNot(), line: t.line };
    }
    return l;
  }
  private parseNot(): Expr {
    if (this.is('kw', 'not')) {
      const t = this.next();
      return { k: 'unary', op: 'not', e: this.parseNot(), line: t.line };
    }
    return this.parseCmp();
  }
  private parseCmp(): Expr {
    const left = this.parseAdd();
    const ops: string[] = [];
    const rights: Expr[] = [];
    for (;;) {
      const k = this.peek();
      if (k.t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(k.v)) {
        this.next();
        ops.push(k.v);
      } else if (k.t === 'kw' && k.v === 'in') {
        this.next();
        ops.push('in');
      } else if (k.t === 'kw' && k.v === 'not' && this.peek(1).t === 'kw' && this.peek(1).v === 'in') {
        this.next();
        this.next();
        ops.push('not in');
      } else if (k.t === 'kw' && k.v === 'is') {
        this.next();
        if (this.accept('kw', 'not')) ops.push('!=');
        else ops.push('==');
      } else break;
      rights.push(this.parseAdd());
    }
    if (!ops.length) return left;
    return { k: 'cmp', left, ops, rights, line: left.line };
  }
  private parseAdd(): Expr {
    let l = this.parseMul();
    while (this.is('op', '+') || this.is('op', '-')) {
      const t = this.next();
      l = { k: 'bin', op: t.v, l, r: this.parseMul(), line: t.line };
    }
    return l;
  }
  private parseMul(): Expr {
    let l = this.parseUnary();
    while (this.is('op', '*') || this.is('op', '/') || this.is('op', '%') || this.is('op', '//')) {
      const t = this.next();
      l = { k: 'bin', op: t.v, l, r: this.parseUnary(), line: t.line };
    }
    return l;
  }
  private parseUnary(): Expr {
    if (this.is('op', '-') || this.is('op', '+')) {
      const t = this.next();
      return { k: 'unary', op: t.v, e: this.parseUnary(), line: t.line };
    }
    return this.parsePow();
  }
  private parsePow(): Expr {
    const b = this.parsePostfix();
    if (this.is('op', '**')) {
      const t = this.next();
      return { k: 'bin', op: '**', l: b, r: this.parseUnary(), line: t.line };
    }
    return b;
  }
  private parsePostfix(): Expr {
    let e = this.parseAtom();
    for (;;) {
      if (this.is('op', '.')) {
        this.next();
        const n = this.expect('name', undefined, 'Ожидалось имя атрибута после «.»');
        e = { k: 'attr', obj: e, name: n.v, line: n.line };
      } else if (this.is('op', '(')) {
        const t = this.next();
        const args: Expr[] = [];
        const kwargs: { name: string; value: Expr }[] = [];
        while (!this.is('op', ')')) {
          if (this.is('name') && this.peek(1).t === 'op' && this.peek(1).v === '=') {
            const n = this.next().v;
            this.next();
            kwargs.push({ name: n, value: this.parseExpr() });
          } else args.push(this.parseExpr());
          if (!this.accept('op', ',')) break;
        }
        this.expect('op', ')', 'Ожидалась «)» после аргументов');
        e = { k: 'call', fn: e, args, kwargs, line: t.line };
      } else if (this.is('op', '[')) {
        const t = this.next();
        const idx = this.parseExpr();
        this.expect('op', ']', 'Ожидалась «]»');
        e = { k: 'index', obj: e, idx, line: t.line };
      } else break;
    }
    return e;
  }
  private parseAtom(): Expr {
    const t = this.next();
    switch (t.t) {
      case 'num':
        return { k: 'num', v: Number(t.v), line: t.line };
      case 'str': {
        let v = t.v;
        while (this.is('str')) v += this.next().v; // implicit concatenation
        return { k: 'str', v, line: t.line };
      }
      case 'name':
        return { k: 'name', id: t.v, line: t.line };
      case 'kw':
        if (t.v === 'True') return { k: 'bool', v: true, line: t.line };
        if (t.v === 'False') return { k: 'bool', v: false, line: t.line };
        if (t.v === 'None') return { k: 'none', line: t.line };
        break;
      case 'op':
        if (t.v === '(') {
          if (this.accept('op', ')')) return { k: 'list', items: [], line: t.line };
          const e = this.parseExpr();
          if (this.is('op', ',')) {
            const items = [e];
            while (this.accept('op', ',')) {
              if (this.is('op', ')')) break;
              items.push(this.parseExpr());
            }
            this.expect('op', ')', 'Ожидалась «)»');
            return { k: 'list', items, line: t.line };
          }
          this.expect('op', ')', 'Ожидалась «)»');
          return e;
        }
        if (t.v === '[') {
          const items: Expr[] = [];
          while (!this.is('op', ']')) {
            items.push(this.parseExpr());
            if (!this.accept('op', ',')) break;
          }
          this.expect('op', ']', 'Ожидалась «]»');
          return { k: 'list', items, line: t.line };
        }
        if (t.v === '{') {
          const keys: Expr[] = [];
          const values: Expr[] = [];
          while (!this.is('op', '}')) {
            keys.push(this.parseExpr());
            this.expect('op', ':', 'Ожидалось «:» в словаре');
            values.push(this.parseExpr());
            if (!this.accept('op', ',')) break;
          }
          this.expect('op', '}', 'Ожидалась «}»');
          return { k: 'dict', keys, values, line: t.line };
        }
        break;
    }
    throw new ScriptError(t.t === 'newline' || t.t === 'eof' ? 'Выражение оборвалось' : `Неожиданное «${t.v || t.t}»`, t.line, t.col);
  }
}

export function parse(src: string): Program {
  return new Parser(src).parseProgram();
}
