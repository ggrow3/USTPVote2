/**
 * Reads CSV text as RFC 4180 describes it, and as spreadsheets save it: fields separated by commas, records by CRLF or
 * LF, a field in double quotes may hold commas, line breaks and doubled quotes (`""`). A UTF-8 byte-order mark is
 * dropped, and so is the empty record after a final line break. `line` is the line each record starts on, counting
 * from 1, so a reader can point at it.
 */
export function readCsv(text: string): { readonly line: number; readonly cells: string[] }[] {
  const records: { line: number; cells: string[] }[] = [];
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let i = 0;
  const endRecord = () => {
    cells.push(cell);
    records.push({ line: start, cells });
    cells = [];
    cell = '';
  };
  while (i < source.length) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      endRecord();
      if (ch === '\r' && source[i + 1] === '\n') i++;
      line++;
      start = line;
    } else cell += ch;
    i++;
  }
  if (cell !== '' || cells.length > 0 || quoted) endRecord();
  return records;
}
