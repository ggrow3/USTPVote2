import { describe, expect, it } from 'vitest';
import { hashCanonical } from './hash.js';
import { canonicalize } from './jcs.js';

describe('RFC 8785 canonicalization', () => {
  it('reproduces the RFC 8785 §3.2.4 example', () => {
    // The RFC's input string, JSON-escaped exactly as printed there; assembled so editors cannot unescape it.
    const esc = (hex: string) => `\\u${hex}`;
    const jsonString = [esc('20ac'), '$', esc('000F'), esc('000a'), "A'", esc('0042'), esc('0022'), esc('005c')]
      .concat(['\\\\', '\\"', '\\/'])
      .join('');
    const input = JSON.parse(
      String.raw`{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],` +
        `"string":"${jsonString}","literals":[null,true,false]}`,
    );
    expect(canonicalize(input)).toBe(
      String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],` +
        String.raw`"string":"€$\u000f\nA'B\"\\\\\"/"}`,
    );
  });

  it('sorts properties by UTF-16 code units (RFC 8785 §3.2.3 example)', () => {
    const input = JSON.parse(
      String.raw`{"€":"Euro Sign","\r":"Carriage Return","דּ":"Hebrew Letter Dalet With Dagesh",` +
        String.raw`"1":"One","😀":"Emoji: Grinning Face","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis"}`,
    );
    // Read the serialized key order directly: JSON.parse would move integer-like keys first.
    const order = [...canonicalize(input).matchAll(/"([^"]*)":"/g)].map((m) => m[1]);
    expect(order).toEqual(['\\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
  });

  it('serializes nested values and omits undefined properties', () => {
    expect(canonicalize({ b: [1, { d: true, c: null }], a: 'x', z: undefined })).toBe(
      '{"a":"x","b":[1,{"c":null,"d":true}]}',
    );
    expect(canonicalize(-0)).toBe('0');
    expect(canonicalize([])).toBe('[]');
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize(Object.assign(Object.create(null) as object, { k: 1 }))).toBe('{"k":1}');
  });

  it('rejects values outside I-JSON', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalize({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalize('\ud800')).toThrow(/lone surrogate/);
    expect(() => canonicalize({ ['\udc00']: 1 })).toThrow(/lone surrogate/);
    expect(() => canonicalize(10n)).toThrow(/unsupported/);
    expect(() => canonicalize(new Date(0))).toThrow(/plain objects/);
    expect(() => canonicalize(new Map())).toThrow(/plain objects/);
    expect(() => canonicalize([1, undefined])).toThrow(/undefined array element/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalize(cyclic)).toThrow(/cyclic/);
  });

  it('allows the same object to appear twice when it is not a cycle', () => {
    const shared = { n: 1 };
    expect(canonicalize({ a: shared, b: shared })).toBe('{"a":{"n":1},"b":{"n":1}}');
  });

  it('hashes the canonical form, independent of property order', () => {
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
    // sha256('{"a":1}')
    expect(hashCanonical({ a: 1 })).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
  });
});
