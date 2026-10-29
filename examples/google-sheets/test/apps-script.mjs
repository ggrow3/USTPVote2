// A stand-in for the parts of Apps Script that Code.gs uses, so it runs unchanged in Node: Code.gs is loaded into a
// vm context whose globals are these fakes. Only the methods Code.gs calls exist, and they check their arguments the
// way Apps Script does where it matters (setValues' dimensions), so a typo or a misuse fails here too. Strings that
// Sheets would read as formulas are kept as formulas, so the tests can check that none are written.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { deflateSync } from 'node:zlib';

const CODE = new URL('../Code.gs', import.meta.url);
const FETCH_HELPER = new URL('./fetch-all.mjs', import.meta.url);

/** Code.gs in a fresh context: `gs.name` is any function or constant it declares. */
export function loadCode(options = {}) {
  const env = fakeAppsScript(options);
  const context = vm.createContext({ ...env.globals, console: options.console ?? console });
  vm.runInContext(readFileSync(CODE, 'utf8'), context, { filename: 'Code.gs' });
  const gs = new Proxy({}, { get: (_, name) => vm.runInContext(String(name), context) });
  return { gs, env };
}

/** `noUi`: as in a time-driven trigger, where there is no UI to alert or toast in. */
function fakeAppsScript({ fetchAll, timeZone = 'Etc/UTC', properties = {}, noUi = false }) {
  const ss = new FakeSpreadsheet(timeZone, noUi);
  const props = new Map(Object.entries(properties));
  const ui = { alerts: [], dialogs: [], menus: [] };
  const drive = { files: [] };
  const requests = [];
  const globals = {
    SpreadsheetApp: {
      getActive: () => ss,
      getUi: () => {
        if (noUi) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
        return fakeUi(ui);
      },
      newRichTextValue: () => {
        const v = { text: '', url: null };
        const builder = { setText: (t) => ((v.text = String(t)), builder), setLinkUrl: (u) => ((v.url = u), builder), build: () => richText(v.text, v.url) };
        return builder;
      },
      newDataValidation: () => {
        const rule = {};
        const builder = {
          requireValueInRange: (range, dropdown) => ((rule.range = range), (rule.dropdown = dropdown), builder),
          setAllowInvalid: (allow) => ((rule.allowInvalid = allow), builder),
          setHelpText: (text) => ((rule.helpText = text), builder),
          build: () => rule,
        };
        return builder;
      },
    },
    Charts: { ChartType: { BAR: 'BAR', COLUMN: 'COLUMN' } },
    UrlFetchApp: {
      fetchAll: (list) => {
        for (const r of list) {
          if (!r.url || r.method !== 'post' || r.muteHttpExceptions !== true) throw new Error(`UrlFetchApp: unexpected request ${JSON.stringify(r)}`);
          requests.push(r);
        }
        return fetchAll(list).map(httpResponse);
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }),
    },
    HtmlService: {
      createTemplateFromFile: (name) => {
        const template = { evaluate: () => htmlOutput(`<template ${name} site=${template.site}>`) };
        return template;
      },
      createHtmlOutput: (html) => htmlOutput(html),
    },
    Utilities: {
      formatDate,
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      newBlob: (data, type, name) => blob(data, type, name),
    },
    Drive: {
      Files: {
        create: (resource, media, optional) => {
          const id = `file-${drive.files.length + 1}`;
          drive.files.push({ resource, media, optional, id });
          return { id, webViewLink: `https://drive.google.com/file/d/${id}/view` };
        },
      },
    },
  };
  return { globals, ss, props, ui, drive, requests };
}

function fakeUi(ui) {
  return {
    ButtonSet: { OK: 'OK' },
    alert: (title, prompt) => ui.alerts.push({ title, prompt }),
    createMenu: (name) => {
      const menu = { name, items: [] };
      const builder = {
        addItem: (label, fn) => (menu.items.push([label, fn]), builder),
        addSeparator: () => (menu.items.push(['-']), builder),
        addToUi: () => ui.menus.push(menu),
      };
      return builder;
    },
    showModalDialog: (output, title) => ui.dialogs.push({ title, html: output.getContent(), modal: true }),
    showModelessDialog: (output, title) => ui.dialogs.push({ title, html: output.getContent(), modal: false }),
  };
}

function httpResponse({ status, headers = {}, body = '' }) {
  return { getResponseCode: () => status, getHeaders: () => headers, getContentText: () => body };
}

function htmlOutput(html) {
  const out = { getContent: () => html, setWidth: () => out, setHeight: () => out };
  return out;
}

function blob(data, type, name) {
  const b = {
    type,
    name,
    data,
    getAs: (to) => blob(data, to, name),
    setName: (n) => ((b.name = n), b),
    getBytes: () => [...(Buffer.isBuffer(data) ? data : Buffer.from(String(data)))],
  };
  return b;
}

function richText(text, url) {
  return { getText: () => text, getLinkUrl: () => url };
}

/** Utilities.formatDate for the patterns Code.gs uses: d, dd, MMM, MM, yyyy, HH, mm, z. */
function formatDate(date, tz, pattern) {
  if (!isDate(date) || Number.isNaN(date.getTime())) throw new Error(`formatDate: not a date: ${date}`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const month = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'short' }).format(date);
  const tokens = { yyyy: parts.year, MMM: month, MM: parts.month, dd: parts.day, d: String(Number(parts.day)), HH: parts.hour, mm: parts.minute, z: parts.timeZoneName };
  return pattern.replace(/yyyy|MMM|MM|dd|d|HH|mm|z/g, (t) => tokens[t]);
}

class FakeSpreadsheet {
  constructor(timeZone, noUi) {
    this.timeZone = timeZone;
    this.noUi = noUi;
    this.sheets = [new FakeSheet(this, 'Sheet1')];
    this.toasts = [];
    this.active = this.sheets[0];
  }
  getSpreadsheetTimeZone() {
    return this.timeZone;
  }
  getSheetByName(name) {
    return this.sheets.find((s) => s.name === name) ?? null;
  }
  getNumSheets() {
    return this.sheets.length;
  }
  insertSheet(name, index) {
    if (this.getSheetByName(name)) throw new Error(`A sheet with the name "${name}" already exists.`);
    if (!Number.isInteger(index) || index < 0 || index > this.sheets.length) throw new Error(`insertSheet: bad index ${index}`);
    const sheet = new FakeSheet(this, name);
    this.sheets.splice(index, 0, sheet);
    this.active = sheet;
    return sheet;
  }
  toast(message, title, seconds) {
    if (this.noUi) throw new Error('no UI');
    this.toasts.push({ message, title, seconds });
  }
}

const MAX_ROWS = 1000;
const MAX_COLS = 26;

class FakeSheet {
  constructor(ss, name) {
    this.ss = ss;
    this.name = name;
    this.cells = new Map();
    this.charts = [];
    this.hidden = false;
    this.frozenRows = 0;
    this.widths = {};
  }
  getName() {
    return this.name;
  }
  cell(row, col) {
    const key = `${row},${col}`;
    if (!this.cells.has(key)) this.cells.set(key, { value: '', formula: null, bold: false });
    return this.cells.get(key);
  }
  getRange(a, col, rows = 1, cols = 1) {
    if (typeof a === 'string') {
      const m = /^([A-Z])(\d+)$/.exec(a);
      if (!m) throw new Error(`getRange: unsupported A1 notation ${a}`);
      return new FakeRange(this, Number(m[2]), m[1].charCodeAt(0) - 64, 1, 1);
    }
    for (const n of [a, col, rows, cols]) if (!Number.isInteger(n) || n < 1) throw new Error(`getRange: bad coordinates ${[a, col, rows, cols]}`);
    return new FakeRange(this, a, col, rows, cols);
  }
  used() {
    return [...this.cells.entries()].filter(([, c]) => c.value !== '' || c.formula || c.rich).map(([k]) => k.split(',').map(Number));
  }
  getLastRow() {
    return Math.max(0, ...this.used().map(([r]) => r));
  }
  getLastColumn() {
    return Math.max(0, ...this.used().map(([, c]) => c));
  }
  getMaxRows() {
    return MAX_ROWS;
  }
  getMaxColumns() {
    return MAX_COLS;
  }
  clear() {
    this.cells.clear();
    return this;
  }
  activate() {
    this.ss.active = this;
    return this;
  }
  isSheetHidden() {
    return this.hidden;
  }
  hideSheet() {
    this.hidden = true;
    return this;
  }
  setFrozenRows(n) {
    this.frozenRows = n;
  }
  setColumnWidth(col, px) {
    this.widths[col] = px;
    return this;
  }
  autoResizeColumns(start, n) {
    if (!(start >= 1 && n >= 1)) throw new Error(`autoResizeColumns: bad columns ${start}, ${n}`);
    return this;
  }
  newChart() {
    return chartBuilder(this);
  }
  insertChart(chart) {
    this.charts.push(chart);
  }
  getCharts() {
    return [...this.charts];
  }
  removeChart(chart) {
    this.charts = this.charts.filter((c) => c !== chart);
  }
  /** The sheet as text rows, for tests and the live run's dump. */
  dump() {
    const rows = [];
    for (let r = 1; r <= this.getLastRow(); r++) {
      const row = [];
      for (let c = 1; c <= this.getLastColumn(); c++) row.push(this.cells.has(`${r},${c}`) ? displayOf(this.cells.get(`${r},${c}`)) : '');
      while (row.length && row.at(-1) === '') row.pop();
      rows.push(row);
    }
    return rows;
  }
}

function displayOf(cell) {
  if (cell.rich) return cell.rich.getText();
  if (cell.formula) return cell.formula;
  const v = cell.value;
  if (isDate(v)) {
    if (cell.numberFormat !== 'yyyy-mm-dd hh:mm') return v.toString();
    return v.toISOString().slice(0, 16).replace('T', ' ');
  }
  return String(v);
}

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  each(fn) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) fn(this.sheet.cell(this.row + i, this.col + j), i, j);
    return this;
  }
  grid(fn) {
    return Array.from({ length: this.rows }, (_, i) => Array.from({ length: this.cols }, (_, j) => fn(this.sheet.cell(this.row + i, this.col + j))));
  }
  getRow() {
    return this.row;
  }
  getNumRows() {
    return this.rows;
  }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.rows || values.some((r) => !Array.isArray(r) || r.length !== this.cols)) {
      throw new Error(`The number of rows or columns in the data does not match the range (${this.rows}x${this.cols}).`);
    }
    return this.each((cell, i, j) => setCell(cell, values[i][j]));
  }
  setValue(value) {
    return this.each((cell) => setCell(cell, value));
  }
  getValue() {
    const cell = this.sheet.cell(this.row, this.col);
    return cell.rich ? cell.rich.getText() : cell.value;
  }
  getDisplayValues() {
    return this.grid(displayOf);
  }
  getFontWeights() {
    return this.grid((c) => (c.bold ? 'bold' : 'normal'));
  }
  setRichTextValue(value) {
    return this.each((cell) => {
      setCell(cell, '');
      cell.rich = value;
    });
  }
  getRichTextValue() {
    const cell = this.sheet.cell(this.row, this.col);
    if (cell.rich) return cell.rich;
    return typeof cell.value === 'string' ? richText(cell.value, null) : null;
  }
  setFontWeight(w) {
    return this.each((c) => (c.bold = w === 'bold'));
  }
  setFontSize(size) {
    return this.each((c) => (c.fontSize = size));
  }
  setFontColor(color) {
    return this.each((c) => (c.color = color));
  }
  setFontFamily(family) {
    return this.each((c) => (c.fontFamily = family));
  }
  setNumberFormat(format) {
    return this.each((c) => (c.numberFormat = format));
  }
  clear() {
    return this.each((c, i, j) => this.sheet.cells.delete(`${this.row + i},${this.col + j}`));
  }
  clearDataValidations() {
    return this.each((c) => delete c.validation);
  }
  setDataValidation(rule) {
    return this.each((c) => (c.validation = rule));
  }
}

/** As Sheets reads a typed value: a leading apostrophe makes text (and is not shown); a leading = makes a formula. */
function setCell(cell, value) {
  delete cell.rich;
  cell.formula = null;
  if (typeof value === 'string' && value.startsWith("'")) cell.value = value.slice(1);
  else if (typeof value === 'string' && value.startsWith('=')) {
    cell.value = '';
    cell.formula = value;
  } else if (value === null || value === undefined) cell.value = '';
  else if (typeof value === 'string' || typeof value === 'number' || isDate(value)) cell.value = value;
  else throw new Error(`setValue: unsupported value ${JSON.stringify(value)}`);
}

/** A grey 52x30 PNG, a chart's shape (520 x 300), standing in for a rendered chart. */
const PNG = greyPng(52, 30);

function greyPng(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.from([0, ...Array(width).fill(0xd8)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(bytes) {
  let crc = ~0;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chartBuilder(sheet) {
  const spec = { options: {}, ranges: [] };
  const builder = {
    setChartType: (type) => ((spec.type = type), builder),
    addRange: (range) => (spec.ranges.push({ row: range.row, col: range.col, rows: range.rows, cols: range.cols }), builder),
    setNumHeaders: (n) => ((spec.numHeaders = n), builder),
    setTransposeRowsAndColumns: (t) => ((spec.transpose = t), builder),
    setPosition: (row, col, x, y) => ((spec.position = { row, col, x, y }), builder),
    setOption: (key, value) => ((spec.options[key] = value), builder),
    build: () => {
      if (!spec.type || !spec.ranges.length || !spec.position) throw new Error('chart: type, range and position are required');
      return { spec, sheet, getContainerInfo: () => ({ getAnchorRow: () => spec.position.row }), getAs: (type) => blob(PNG, type, 'chart.png') };
    },
  };
  return builder;
}

// ------------------------------------------------------------------------------------------------- fetch backends

/**
 * Answers MCP requests from a recording (record.mjs): `initialize`, `tools/list` and each tool call by its name and
 * arguments. A JSON body unless `sse` asks for an event stream.
 */
export function fixtureFetch(recording, { sse = false, override = {} } = {}) {
  return (requests) =>
    requests.map((r) => {
      const message = JSON.parse(r.payload);
      if (!/application\/json/.test(r.headers.Accept) || !/text\/event-stream/.test(r.headers.Accept)) {
        return { status: 406, headers: { 'Content-Type': 'application/json' }, body: '{"error":"Not Acceptable"}' };
      }
      if (message.id === undefined) return { status: 202, headers: {}, body: '' };
      const key = message.method === 'tools/call' ? callKey(message.params.name, message.params.arguments) : message.method;
      const result = key in override ? override[key] : recording.answers[key];
      const body = JSON.stringify(
        result === undefined ? { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `not recorded: ${key}` } } : { result, jsonrpc: '2.0', id: message.id },
      );
      return sse
        ? { status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: `event: message\ndata: ${body}\n\n` }
        : { status: 200, headers: { 'Content-Type': 'application/json' }, body };
    });
}

export function callKey(name, args = {}) {
  return `${name} ${JSON.stringify(Object.fromEntries(Object.entries(args).sort()))}`;
}

/** Real HTTP, made synchronous for UrlFetchApp by a child process that fetches them all. */
export function liveFetch(requests) {
  const out = execFileSync(process.execPath, [fileURLToPath(FETCH_HELPER)], {
    input: JSON.stringify(requests),
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.toString('utf8'));
}

/** A Date from any realm: Code.gs makes its own in the vm context. */
function isDate(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}
