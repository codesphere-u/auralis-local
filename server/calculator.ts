// A bounded arithmetic parser. Never evaluates JavaScript or invokes a shell.
export function calculate(expression: string): number {
  if (expression.length > 256 || !/^[\d\s.+\-*/()%]+$/.test(expression)) throw new Error('Use numbers, parentheses and + - * / % only.');
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/%]/g) || [];
  let pos = 0;
  const atom = (): number => {
    const t = tokens[pos++];
    if (t === '+' || t === '-') return (t === '-' ? -1 : 1) * atom();
    if (t === '(') { const n = sum(); if (tokens[pos++] !== ')') throw new Error('Unbalanced parentheses'); return n; }
    if (t === undefined || !/^(\d+(\.\d*)?|\.\d+)$/.test(t)) throw new Error('Expected a number');
    return Number(t);
  };
  const product = (): number => {
    let n = atom();
    while (['*', '/', '%'].includes(tokens[pos])) { const op = tokens[pos++]; const rhs = atom(); n = op === '*' ? n * rhs : op === '/' ? n / rhs : n % rhs; }
    return n;
  };
  const sum = (): number => {
    let n = product();
    while (['+', '-'].includes(tokens[pos])) { const op = tokens[pos++]; const rhs = product(); n = op === '+' ? n + rhs : n - rhs; }
    return n;
  };
  const result = sum();
  if (pos !== tokens.length || !Number.isFinite(result)) throw new Error('Invalid or non-finite result');
  return result;
}
