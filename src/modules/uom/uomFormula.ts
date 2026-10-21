import Decimal from "decimal.js";

export type UomVar = "v1" | "v2" | "v3";

type Token =
  | { kind: "num"; value: string }
  | { kind: "var"; name: UomVar }
  | { kind: "op"; op: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

type Ast =
  | { kind: "num"; value: Decimal }
  | { kind: "var"; name: UomVar }
  | { kind: "unary"; op: "-"; right: Ast }
  | { kind: "bin"; op: "+" | "-" | "*" | "/"; left: Ast; right: Ast };

export type ParsedUomFormula = {
  expression: string;
  variableCount: number;
  variables: UomVar[];
};

const TOKEN_RE =
  /\s*(?:(\d+(?:\.\d+)?)|(v[123])|([+\-*/()])|(\S))/gy;

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  while (TOKEN_RE.lastIndex < expr.length) {
    const m = TOKEN_RE.exec(expr);
    if (!m) break;
    if (m[4]) {
      throw new Error(`Invalid token "${m[4]}" in formula`);
    }
    if (m[1] !== undefined) {
      tokens.push({ kind: "num", value: m[1] });
      continue;
    }
    if (m[2] !== undefined) {
      const name = m[2] as UomVar;
      tokens.push({ kind: "var", name });
      continue;
    }
    const ch = m[3];
    if (ch === "(") tokens.push({ kind: "lparen" });
    else if (ch === ")") tokens.push({ kind: "rparen" });
    else tokens.push({ kind: "op", op: ch as "+" | "-" | "*" | "/" });
  }
  return tokens;
}

function collectVars(ast: Ast, set: Set<UomVar>): void {
  switch (ast.kind) {
    case "num":
      return;
    case "var":
      set.add(ast.name);
      return;
    case "unary":
      collectVars(ast.right, set);
      return;
    case "bin":
      collectVars(ast.left, set);
      collectVars(ast.right, set);
      return;
  }
}

function parseTokens(tokens: Token[]): Ast {
  let i = 0;

  function peek(): Token | undefined {
    return tokens[i];
  }

  function take(): Token {
    const t = tokens[i];
    if (!t) throw new Error("Unexpected end of formula");
    i += 1;
    return t;
  }

  function parseExpr(): Ast {
    let left = parseTerm();
    while (true) {
      const t = peek();
      if (t?.kind !== "op" || (t.op !== "+" && t.op !== "-")) break;
      const op = (take() as { kind: "op"; op: "+" | "-" }).op;
      const right = parseTerm();
      left = { kind: "bin", op, left, right };
    }
    return left;
  }

  function parseTerm(): Ast {
    let left = parseFactor();
    while (
      peek()?.kind === "op" &&
      ((peek() as { op: string }).op === "*" ||
        (peek() as { op: string }).op === "/")
    ) {
      const op = (take() as { kind: "op"; op: "*" | "/" }).op;
      const right = parseFactor();
      left = { kind: "bin", op, left, right };
    }
    return left;
  }

  function parseFactor(): Ast {
    const t = peek();
    if (!t) throw new Error("Unexpected end of formula");

    if (t.kind === "op" && t.op === "-") {
      take();
      return { kind: "unary", op: "-", right: parseFactor() };
    }
    if (t.kind === "op" && t.op === "+") {
      take();
      return parseFactor();
    }
    if (t.kind === "lparen") {
      take();
      const inner = parseExpr();
      const close = take();
      if (close.kind !== "rparen") throw new Error("Expected )");
      return inner;
    }
    if (t.kind === "num") {
      take();
      return { kind: "num", value: new Decimal(t.value) };
    }
    if (t.kind === "var") {
      take();
      return { kind: "var", name: t.name };
    }
    throw new Error("Invalid formula");
  }

  if (tokens.length === 0) throw new Error("Formula is required");
  const ast = parseExpr();
  if (i < tokens.length) throw new Error("Unexpected trailing tokens in formula");
  return ast;
}

function assertVarContinuity(vars: Set<UomVar>): UomVar[] {
  const ordered: UomVar[] = [];
  for (const name of ["v1", "v2", "v3"] as const) {
    if (vars.has(name)) ordered.push(name);
  }
  if (ordered.length === 0) {
    throw new Error("Formula must use at least v1");
  }
  for (let n = 1; n <= ordered.length; n += 1) {
    const expected = `v${n}` as UomVar;
    if (!vars.has(expected)) {
      throw new Error("Formula variables must be contiguous from v1");
    }
  }
  if (vars.size !== ordered.length) {
    throw new Error("Formula variables must be contiguous from v1");
  }
  return ordered;
}

function evalAst(ast: Ast, values: Partial<Record<UomVar, Decimal>>): Decimal {
  switch (ast.kind) {
    case "num":
      return ast.value;
    case "var": {
      const v = values[ast.name];
      if (v === undefined) throw new Error(`Missing value for ${ast.name}`);
      return v;
    }
    case "unary":
      return evalAst(ast.right, values).neg();
    case "bin": {
      const left = evalAst(ast.left, values);
      const right = evalAst(ast.right, values);
      switch (ast.op) {
        case "+":
          return left.plus(right);
        case "-":
          return left.minus(right);
        case "*":
          return left.times(right);
        case "/":
          if (right.isZero()) throw new Error("Division by zero");
          return left.div(right);
      }
    }
  }
}

/** Canonical spacing: `v1 * v2`. */
function canonicalizeExpression(expr: string): string {
  const tokens = tokenize(expr.trim());
  let out = "";
  for (const t of tokens) {
    switch (t.kind) {
      case "num":
        out += (out && !out.endsWith("(") ? " " : "") + t.value;
        break;
      case "var":
        out += (out && !out.endsWith("(") ? " " : "") + t.name;
        break;
      case "op":
        out += ` ${t.op} `;
        break;
      case "lparen":
        out += (out && !out.endsWith(" ") && !out.endsWith("(") ? " " : "") + "(";
        break;
      case "rparen":
        out += ")";
        break;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

export function parseUomFormula(expr: string): ParsedUomFormula {
  if (typeof expr !== "string" || !expr.trim()) {
    throw new Error("Formula is required");
  }
  const trimmed = expr.trim();
  const tokens = tokenize(trimmed);
  const ast = parseTokens(tokens);
  const varSet = new Set<UomVar>();
  collectVars(ast, varSet);
  const variables = assertVarContinuity(varSet);
  return {
    expression: canonicalizeExpression(trimmed),
    variableCount: variables.length,
    variables,
  };
}

export function evalUomFormula(
  expr: string,
  values: Partial<Record<UomVar, number | string>>,
): string {
  const parsed = parseUomFormula(expr);
  const decimals: Partial<Record<UomVar, Decimal>> = {};
  for (const name of parsed.variables) {
    const raw = values[name];
    if (raw === undefined || raw === "") {
      throw new Error(`Missing value for ${name}`);
    }
    try {
      decimals[name] = new Decimal(raw);
    } catch {
      throw new Error(`${name} must be a valid number`);
    }
  }
  const tokens = tokenize(parsed.expression);
  const ast = parseTokens(tokens);
  return evalAst(ast, decimals).toString();
}

export function normalizeFormulas(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("At least one formula is required");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new Error("Each formula must be a string");
    }
    const parsed = parseUomFormula(item);
    if (seen.has(parsed.expression)) continue;
    seen.add(parsed.expression);
    out.push(parsed.expression);
  }
  if (out.length === 0) {
    throw new Error("At least one formula is required");
  }
  return out;
}

export function defaultFormulasOr(formulas: string[] | undefined): string[] {
  if (!formulas || formulas.length === 0) return ["v1"];
  return formulas;
}
