export function parseStrictJSON(input) {
  const text =
    typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input);
  let at = 0;
  let values = 0;
  const white = () => {
    while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++;
  };
  function string() {
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') {
        const decoded = JSON.parse(text.slice(start, at));
        if (!decoded.isWellFormed()) throw new Error('Malformed Unicode surrogate in JSON.');
        return decoded;
      }
      if (char === '\\') at++;
    }
    throw new Error('Unterminated JSON string.');
  }
  function value(depth) {
    if (depth > 32) throw new Error('JSON nesting limit exceeded.');
    if (++values > 1_000_000) throw new Error('JSON value limit exceeded.');
    white();
    if (text[at] === '"') return string();
    if (text[at] === '{') {
      at++;
      white();
      const object = Object.create(null);
      const keys = new Set();
      if (text[at] === '}') {
        at++;
        return object;
      }
      for (;;) {
        if (keys.size >= 100_000) throw new Error('JSON container entry limit exceeded.');
        white();
        if (text[at] !== '"') throw new Error('Expected JSON object key.');
        const key = string();
        white();
        if (keys.has(key.normalize('NFC'))) throw new Error('Duplicate JSON key.');
        keys.add(key.normalize('NFC'));
        if (text[at++] !== ':') throw new Error('Expected JSON colon.');
        object[key] = value(depth + 1);
        white();
        const separator = text[at++];
        if (separator === '}') return object;
        if (separator !== ',') throw new Error('Expected JSON object separator.');
      }
    }
    if (text[at] === '[') {
      at++;
      white();
      const array = [];
      if (text[at] === ']') {
        at++;
        return array;
      }
      for (;;) {
        if (array.length >= 100_000) throw new Error('JSON container entry limit exceeded.');
        array.push(value(depth + 1));
        white();
        const separator = text[at++];
        if (separator === ']') return array;
        if (separator !== ',') throw new Error('Expected JSON array separator.');
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      text.slice(at),
    );
    if (!match) throw new Error('Invalid JSON value.');
    at += match[0].length;
    const parsed = JSON.parse(match[0]);
    if (
      typeof parsed === 'number' &&
      (!/^(0|[1-9][0-9]*)$/.test(match[0]) || !Number.isSafeInteger(parsed))
    )
      throw new Error('Protocol numbers must be nonnegative safe integer literals.');
    return parsed;
  }
  const parsed = value(0);
  white();
  if (at !== text.length) throw new Error('Trailing JSON data.');
  return parsed;
}
