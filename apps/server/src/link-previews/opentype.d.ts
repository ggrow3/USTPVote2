/** The little of opentype.js (MIT, ships no types) that card images use: text to outlines, and advance widths. */
declare module 'opentype.js' {
  /** M, L, Q, C or Z, with the points each takes. */
  export interface PathCommand {
    readonly type: string;
    readonly x?: number;
    readonly y?: number;
    readonly x1?: number;
    readonly y1?: number;
    readonly x2?: number;
    readonly y2?: number;
  }
  export interface Path {
    readonly commands: readonly PathCommand[];
    toPathData(decimalPlaces?: number): string;
  }
  export interface Font {
    readonly unitsPerEm: number;
    readonly ascender: number;
    readonly descender: number;
    charToGlyphIndex(char: string): number;
    getPath(text: string, x: number, y: number, fontSize: number, options?: { readonly kerning?: boolean }): Path;
    getAdvanceWidth(text: string, fontSize: number, options?: { readonly kerning?: boolean }): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
