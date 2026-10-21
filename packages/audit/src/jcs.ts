/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * Input is restricted to I-JSON: finite numbers, well-formed strings, plain objects and arrays. Anything else
 * throws rather than being silently coerced. Object properties whose value is `undefined` are omitted, as
 * `JSON.stringify` does; `undefined` array elements throw.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, []);
}

function serialize(value: unknown, ancestors: object[]): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`JCS: non-finite number ${value}`);
      // ECMAScript Number serialization is exactly what RFC 8785 §3.2.2.3 specifies; -0 becomes "0".
      return JSON.stringify(value);
    case 'string':
      return serializeString(value);
    case 'object': {
      if (ancestors.includes(value)) throw new TypeError('JCS: cyclic structure');
      ancestors.push(value);
      const out = Array.isArray(value) ? serializeArray(value, ancestors) : serializeObject(value, ancestors);
      ancestors.pop();
      return out;
    }
    default:
      throw new TypeError(`JCS: unsupported type ${typeof value}`);
  }
}

function serializeString(s: string): string {
  if (!s.isWellFormed()) throw new TypeError('JCS: string contains a lone surrogate');
  // JSON.stringify's escaping (RFC 8785 §3.2.2.2): only ", \ and control characters, lowercase hex.
  return JSON.stringify(s);
}

function serializeArray(items: readonly unknown[], ancestors: object[]): string {
  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i] === undefined) throw new TypeError(`JCS: undefined array element at ${i}`);
    parts.push(serialize(items[i], ancestors));
  }
  return `[${parts.join(',')}]`;
}

function serializeObject(obj: object, ancestors: object[]): string {
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`JCS: only plain objects are allowed, got ${proto?.constructor?.name ?? 'unknown'}`);
  }
  const record = obj as Record<string, unknown>;
  // Default sort compares UTF-16 code units, which is the RFC 8785 §3.2.3 property order.
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${serializeString(k)}:${serialize(record[k], ancestors)}`).join(',')}}`;
}
