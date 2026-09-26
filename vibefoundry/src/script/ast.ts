/** FactoryScript AST. Every node carries its source line for error reporting. */
export type Expr =
  | { k: 'num'; v: number; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'bool'; v: boolean; line: number }
  | { k: 'none'; line: number }
  | { k: 'name'; id: string; line: number }
  | { k: 'attr'; obj: Expr; name: string; line: number }
  | { k: 'index'; obj: Expr; idx: Expr; line: number }
  | { k: 'call'; fn: Expr; args: Expr[]; kwargs: { name: string; value: Expr }[]; line: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'unary'; op: string; e: Expr; line: number }
  | { k: 'bool_op'; op: 'and' | 'or'; l: Expr; r: Expr; line: number }
  | { k: 'cmp'; left: Expr; ops: string[]; rights: Expr[]; line: number }
  | { k: 'list'; items: Expr[]; line: number }
  | { k: 'dict'; keys: Expr[]; values: Expr[]; line: number }
  | { k: 'ternary'; test: Expr; a: Expr; b: Expr; line: number };

export type Stmt =
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'assign'; target: Expr; op: string; value: Expr; line: number }
  | { k: 'if'; test: Expr; body: Stmt[]; orelse: Stmt[]; line: number }
  | { k: 'for'; target: string; iter: Expr; body: Stmt[]; line: number }
  | { k: 'while'; test: Expr; body: Stmt[]; line: number }
  | { k: 'return'; e: Expr | null; line: number }
  | { k: 'pass'; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number };

export interface FuncDef {
  name: string;
  params: string[];
  body: Stmt[];
  line: number;
}

export interface ClassDef {
  name: string;
  base: string | null;
  fields: { name: string; value: Expr; line: number }[];
  methods: FuncDef[];
  line: number;
}

export interface Program {
  classes: ClassDef[];
}
