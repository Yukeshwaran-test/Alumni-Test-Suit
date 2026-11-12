import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Writes the test execution results sheet for tests that call `tc()` (utils/testCase.ts):
 *   reports/registration-results.csv  (opens in Excel)
 *   reports/registration-results.html
 * Columns: Test Case ID, Module, Test Scenario, Type, Test Steps, Test Data, Expected Result,
 *          Actual Result, Status, Duration, Notes.
 */
type Row = Record<string, string>;
const COLS = ['Test Case ID', 'Module', 'Test Scenario', 'Type', 'Test Steps', 'Test Data', 'Expected Result', 'Actual Result', 'Status', 'Duration (s)', 'Notes'];

export default class CaseReporter implements Reporter {
  private rows = new Map<string, Row>();

  onTestEnd(test: TestCase, result: TestResult) {
    // Runtime annotations can show up on both the test and the result — keep each once.
    const seen = new Set<string>();
    const ann = [...test.annotations, ...result.annotations].filter(a => {
      const k = `${a.type}\u0000${a.description}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    const get = (t: string) => ann.filter(a => a.type === t).map(a => a.description ?? '');
    // A test that fails in beforeEach never reaches tc(); fall back to the ID in its title.
    // ("E2E-006" has a digit in its prefix.)
    const id = get('tc:id')[0] ?? test.title.match(/^[A-Z0-9]+-\d+/)?.[0];
    if (!id) return;
    if (!get('tc:scenario').length) ann.push({ type: 'tc:scenario', description: test.title.replace(/^[A-Z0-9]+-\d+\s*/, '') });
    const err = result.errors.map(e => (e.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 4).join(' ')).join(' | ');
    const status = result.status === 'passed' ? 'Pass'
      : result.status === 'skipped' ? 'Skipped'
      : test.expectedStatus === 'failed' && result.status === 'failed' ? 'Fail (known)'
      : 'Fail';
    const actualText = get('tc:actual').join('; ') || (result.status === 'passed' ? 'As expected' : '');
    this.rows.set(id, {
      'Test Case ID': id,
      Module: get('tc:module')[0],
      'Test Scenario': get('tc:scenario')[0],
      Type: get('tc:type')[0],
      'Test Steps': get('tc:steps')[0],
      'Test Data': get('tc:data')[0],
      'Expected Result': get('tc:expected')[0],
      'Actual Result': [actualText, err && `Error: ${err}`].filter(Boolean).join(' | '),
      Status: status,
      'Duration (s)': (result.duration / 1000).toFixed(1),
      Notes: ann.filter(a => !a.type.startsWith('tc:')).map(a => `${a.type}: ${a.description ?? ''}`).join('; '),
    });
  }

  onEnd(_: FullResult) {
    if (!this.rows.size) return;
    // Merge with the previous sheet so re-running a few tests updates only their rows.
    // Set CASE_REPORT_FRESH=1 to start a new sheet.
    const csvPath = path.join('reports', 'registration-results.csv');
    if (!process.env.CASE_REPORT_FRESH && fs.existsSync(csvPath)) {
      for (const old of parseCsv(fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '')).slice(1)) {
        if (old[0] && !this.rows.has(old[0])) this.rows.set(old[0], Object.fromEntries(COLS.map((c, i) => [c, old[i] ?? ''])));
      }
    }
    const rows = [...this.rows.values()].sort((a, b) => a['Test Case ID'].localeCompare(b['Test Case ID'], undefined, { numeric: true }));
    fs.mkdirSync('reports', { recursive: true });
    const csvCell = (s = '') => `"${s.replace(/"/g, '""')}"`;
    fs.writeFileSync(path.join('reports', 'registration-results.csv'),
      '﻿' + [COLS.map(csvCell).join(','), ...rows.map(r => COLS.map(c => csvCell(r[c])).join(','))].join('\r\n'));

    const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const count = (s: string) => rows.filter(r => r.Status.startsWith(s)).length;
    const html = `<!doctype html><meta charset="utf-8"><title>Registration Test Results</title>
<style>body{font:13px system-ui,sans-serif;margin:16px;color:#1d1d1f}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccc;padding:6px;vertical-align:top;white-space:pre-wrap}th{background:#f1f1f4;position:sticky;top:0}
.Pass{background:#e7f6ec}.Fail{background:#fde8e8}.Skipped{background:#f6f6f6}</style>
<h1>Alumni Registration — Test Execution Results</h1>
<p>Run: ${new Date().toLocaleString()} · Total ${rows.length} · Pass ${count('Pass')} · Fail ${count('Fail')} · Skipped ${count('Skipped')}</p>
<table><tr>${COLS.map(c => `<th>${c}</th>`).join('')}</tr>
${rows.map(r => `<tr class="${r.Status.split(' ')[0]}">${COLS.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('\n')}</table>`;
    fs.writeFileSync(path.join('reports', 'registration-results.html'), html);
    console.log(`\nTest case results: reports/registration-results.csv and .html (${rows.length} cases)`);
  }
}

function parseCsv(t: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
