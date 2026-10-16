import { deepEqual } from './deep-equal.ts';

/**
 * 受限布尔表达式求值（设计 14）。无函数调用、无赋值。
 */
export class PredicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredicateError';
  }
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'punc'; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.trim();
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      i += 1;
      let v = '';
      while (i < s.length && s[i] !== q) {
        v += s[i];
        i += 1;
      }
      if (s[i] !== q) throw new PredicateError('字符串未闭合');
      i += 1;
      tokens.push({ kind: 'str', value: v });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let v = c;
      i += 1;
      while (i < s.length && /[0-9.]/.test(s[i]!)) {
        v += s[i];
        i += 1;
      }
      tokens.push({ kind: 'num', value: Number(v) });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let v = c;
      i += 1;
      while (i < s.length && /[A-Za-z0-9_]/.test(s[i]!)) {
        v += s[i];
        i += 1;
      }
      if (v === 'true') tokens.push({ kind: 'bool', value: true });
      else if (v === 'false') tokens.push({ kind: 'bool', value: false });
      else if (v === 'null') tokens.push({ kind: 'null' });
      else tokens.push({ kind: 'ident', value: v });
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if ('!<>.()[]'.includes(c)) {
      tokens.push(
        c === '!' || c === '<' || c === '>' ? { kind: 'op', value: c } : { kind: 'punc', value: c },
      );
      i += 1;
      continue;
    }
    throw new PredicateError(`非法字符: ${c}`);
  }
  return tokens;
}

class Parser {
  private i = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }
  private take(): Token {
    const t = this.tokens[this.i];
    if (t === undefined) throw new PredicateError('意外结尾');
    this.i += 1;
    return t;
  }
  private matchOp(...ops: string[]): string | undefined {
    const t = this.peek();
    if (t?.kind === 'op' && ops.includes(t.value)) {
      this.i += 1;
      return t.value;
    }
    return undefined;
  }
  private matchPunc(p: string): boolean {
    const t = this.peek();
    if (t?.kind === 'punc' && t.value === p) {
      this.i += 1;
      return true;
    }
    return false;
  }

  parse(): Ast {
    const ast = this.parseOr();
    if (this.i !== this.tokens.length) throw new PredicateError('表达式后有多余内容');
    return ast;
  }

  private parseOr(): Ast {
    let left = this.parseAnd();
    while (this.matchOp('||')) {
      left = { type: 'bin', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }
  private parseAnd(): Ast {
    let left = this.parseCmp();
    while (this.matchOp('&&')) {
      left = { type: 'bin', op: '&&', left, right: this.parseCmp() };
    }
    return left;
  }
  private parseCmp(): Ast {
    const left = this.parseUnary();
    const op = this.matchOp('==', '!=', '<', '<=', '>', '>=');
    if (op) return { type: 'bin', op, left, right: this.parseUnary() };
    return left;
  }
  private parseUnary(): Ast {
    if (this.matchOp('!')) return { type: 'not', expr: this.parseUnary() };
    return this.parsePrimary();
  }
  private parsePrimary(): Ast {
    if (this.matchPunc('(')) {
      const e = this.parseOr();
      if (!this.matchPunc(')')) throw new PredicateError('缺少 )');
      return e;
    }
    const t = this.take();
    if (t.kind === 'num') return { type: 'lit', value: t.value };
    if (t.kind === 'str') return { type: 'lit', value: t.value };
    if (t.kind === 'bool') return { type: 'lit', value: t.value };
    if (t.kind === 'null') return { type: 'lit', value: null };
    if (t.kind === 'ident') {
      const parts: (string | number)[] = [t.value];
      for (;;) {
        if (this.matchPunc('.')) {
          const id = this.take();
          if (id.kind !== 'ident') throw new PredicateError('点后须为标识符');
          parts.push(id.value);
          continue;
        }
        if (this.matchPunc('[')) {
          const idx = this.take();
          if (idx.kind === 'num') parts.push(idx.value);
          else if (idx.kind === 'str') parts.push(idx.value);
          else throw new PredicateError('下标须为数字或字符串');
          if (!this.matchPunc(']')) throw new PredicateError('缺少 ]');
          continue;
        }
        break;
      }
      return { type: 'path', parts };
    }
    throw new PredicateError('无法解析的主键');
  }
}

type Ast =
  | { type: 'lit'; value: unknown }
  | { type: 'path'; parts: (string | number)[] }
  | { type: 'not'; expr: Ast }
  | { type: 'bin'; op: string; left: Ast; right: Ast };

function readPath(root: unknown, parts: (string | number)[]): unknown {
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return null;
    cur = (cur as Record<string | number, unknown>)[p as string];
  }
  return cur === undefined ? null : cur;
}

function strictEq(a: unknown, b: unknown): boolean {
  return deepEqual(a, b);
}

function evalAst(ast: Ast, root: unknown): unknown {
  switch (ast.type) {
    case 'lit':
      return ast.value;
    case 'path':
      return readPath(root, ast.parts);
    case 'not': {
      const v = evalAst(ast.expr, root);
      if (typeof v !== 'boolean') throw new PredicateError('! 运算元须为 boolean');
      return !v;
    }
    case 'bin': {
      if (ast.op === '&&' || ast.op === '||') {
        const l = evalAst(ast.left, root);
        if (typeof l !== 'boolean') throw new PredicateError(`${ast.op} 左侧须为 boolean`);
        if (ast.op === '&&' && !l) return false;
        if (ast.op === '||' && l) return true;
        const r = evalAst(ast.right, root);
        if (typeof r !== 'boolean') throw new PredicateError(`${ast.op} 右侧须为 boolean`);
        return r;
      }
      const l = evalAst(ast.left, root);
      const r = evalAst(ast.right, root);
      if (ast.op === '==') return strictEq(l, r);
      if (ast.op === '!=') return !strictEq(l, r);
      if (typeof l !== typeof r || (typeof l !== 'number' && typeof l !== 'string')) {
        throw new PredicateError(`比较运算类型不合法: ${typeof l} ${ast.op} ${typeof r}`);
      }
      if (ast.op === '<') return (l as number | string) < (r as number | string);
      if (ast.op === '<=') return (l as number | string) <= (r as number | string);
      if (ast.op === '>') return (l as number | string) > (r as number | string);
      if (ast.op === '>=') return (l as number | string) >= (r as number | string);
      throw new PredicateError(`未知运算符 ${ast.op}`);
    }
  }
}

/** 求值；结果必须是 boolean，否则抛 PredicateError。 */
export function evalStatePredicate(expr: string, root: unknown): boolean {
  const ast = new Parser(tokenize(expr)).parse();
  const v = evalAst(ast, root);
  if (typeof v !== 'boolean') throw new PredicateError(`谓词结果须为 boolean，实际为 ${typeof v}`);
  return v;
}
