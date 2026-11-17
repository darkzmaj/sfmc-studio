// Minimal Valve KeyValues (VMT / VDF) parser. Keys are lowercased; duplicate
// keys keep the first value (matches how the engine resolves most VMT params).
// Platform conditionals such as [$X360] are skipped entirely.

export type KV = { [key: string]: string | KV };

const MAX_DEPTH = 64;

export function parseKeyValues(text: string): KV {
  let i = 0;
  const n = text.length;

  function skip() {
    while (i < n) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
      } else if (c <= ' ' || c === '﻿') i++;
      else break;
    }
  }

  function token(): string | null {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === '{' || c === '}') { i++; return c; }
    if (c === '"') {
      const s = ++i;
      while (i < n && text[i] !== '"') i++;
      return text.slice(s, i++);
    }
    const s = i;
    while (i < n && text[i] > ' ' && text[i] !== '{' && text[i] !== '}' && text[i] !== '"') i++;
    return text.slice(s, i);
  }

  function peekConditional() {
    skip();
    if (text[i] === '[') {
      const end = text.indexOf(']', i);
      i = end < 0 ? n : end + 1;
    }
  }

  function block(depth: number): KV {
    if (depth > MAX_DEPTH) throw new Error('KeyValues nesting too deep');
    const out: KV = {};
    for (;;) {
      const key = token();
      if (key === null || key === '}') return out;
      if (key === '{') continue; // stray brace; tolerate
      const value = token();
      if (value === null) return out;
      const v = value === '{' ? block(depth + 1) : value;
      peekConditional();
      const k = key.toLowerCase();
      if (!(k in out)) out[k] = v;
    }
  }

  return block(0);
}

/** Root of a VMT/VDF: returns [shaderOrRootName, body]. */
export function parseRoot(text: string): [string, KV] {
  const kv = parseKeyValues(text);
  const [name] = Object.keys(kv);
  const body = name ? kv[name] : {};
  return [name ?? '', typeof body === 'string' ? {} : body];
}

export function kvString(kv: KV, key: string): string | undefined {
  const v = kv[key.toLowerCase()];
  return typeof v === 'string' ? v : undefined;
}

/** Parse "[1 0.5 0.2]" / "{255 128 0}" / "1" into a numeric triple. Curly braces are 0-255. */
export function kvVector(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const nums = value.replace(/[[\]{}]/g, ' ').trim().split(/\s+/).map(Number);
  if (nums.some(Number.isNaN) || nums.length === 0) return undefined;
  const scale = value.trim().startsWith('{') ? 1 / 255 : 1;
  const [r, g = r, b = r] = nums;
  return [r * scale, g * scale, b * scale];
}
