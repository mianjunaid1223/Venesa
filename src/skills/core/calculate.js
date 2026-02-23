/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: calculate
 *  Evaluate a math expression safely.
 * ═══════════════════════════════════════════════════════════════
 */

function safeEvaluate(expr) {
    let pos = 0;
    const str = expr.replace(/\s+/g, '');

    function parseExpr() {
        let left = parseTerm();
        while (pos < str.length && (str[pos] === '+' || str[pos] === '-')) {
            const op = str[pos++];
            const right = parseTerm();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }

    function parseTerm() {
        let left = parsePower();
        while (pos < str.length && (str[pos] === '*' || str[pos] === '/' || str[pos] === '%')) {
            const op = str[pos++];
            const right = parsePower();
            if (op === '*') left = left * right;
            else if (op === '/') { if (right === 0) throw new Error('Division by zero'); left = left / right; }
            else left = left % right;
        }
        return left;
    }

    function parsePower() {
        let base = parseUnary();
        if (pos < str.length - 1 && str[pos] === '*' && str[pos + 1] === '*') {
            pos += 2;
            const exp = parsePower();
            base = Math.pow(base, exp);
        }
        return base;
    }

    function parseUnary() {
        if (str[pos] === '-') { pos++; return -parseAtom(); }
        if (str[pos] === '+') { pos++; return parseAtom(); }
        return parseAtom();
    }

    function parseAtom() {
        if (str[pos] === '(') {
            pos++;
            const val = parseExpr();
            if (str[pos] !== ')') throw new Error(`Expected ')' at position ${pos}`);
            pos++;
            return val;
        }
        const start = pos;
        while (pos < str.length && (str[pos] >= '0' && str[pos] <= '9' || str[pos] === '.')) {
            pos++;
        }
        if (pos === start) throw new Error('Unexpected token');
        return parseFloat(str.substring(start, pos));
    }

    const result = parseExpr();
    if (pos < str.length) throw new Error('Unexpected trailing characters');
    return result;
}

module.exports = {
    name: 'calculate',
    description: 'Evaluate a math expression',
    tags: ['math', 'calculate'],
    permission: 'safe',
    marker: 'silently',
    ui: null,

    handler(params) {
        const expression = params?.expression;
        if (!expression || typeof expression !== 'string') return JSON.stringify({ error: 'No expression provided' });
        const sanitized = expression.replace(/[^0-9+\-*/.()%^ ]/g, '');
        if (!sanitized.trim()) return JSON.stringify({ error: 'Invalid expression' });
        try {
            const prepared = sanitized
                .replace(/\^/g, '**')
                .replace(/(\d+(?:\.\d+)?)%(?!\d)/g, '($1/100)');
            const result = safeEvaluate(prepared);
            if (result === null || !isFinite(result)) {
                return JSON.stringify({ expression, error: 'Could not compute' });
            }
            return JSON.stringify({ expression, result: String(result) });
        } catch (e) {
            return JSON.stringify({ expression, error: 'Could not compute' });
        }
    },
};
