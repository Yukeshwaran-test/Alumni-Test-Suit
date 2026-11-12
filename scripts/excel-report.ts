/**
 * Builds an Excel test report from the last Playwright run (test-results/results.json):
 *   Summary     - QA report header: metrics (Total / Passed / Failed / Blocked / Skipped),
 *                 run details with one row per run (history), and module-wise results
 *   Test Cases  - every test with its module, type, status, duration and error
 *   Failures    - failed tests only, with the error and screenshot path
 * Saved to reports/test-report_<date>.xlsx; run history is kept in reports/run-history.json.
 *
 * Run details can be set per run (PowerShell):
 *   $env:REPORT_RELEASE="Sprint 12"; $env:REPORT_BUILD="v2.4.1"; $env:REPORT_NOTES="Regression"; npm run report:excel
 * Also: REPORT_PROJECT, REPORT_ENV, REPORT_TESTER, REPORT_FRAMEWORK.
 *
 * Run:  npm run report:excel   (after any test run)
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const RESULTS = 'test-results/results.json';
const HISTORY = 'reports/run-history.json';

// The 8 modules first, then Login/Registration/Home/General (shown only when they ran).
const MODULES = [
  'Events', 'Network', 'Mentorship', 'Fundraise', 'Groups & Chat', 'Business Directory',
  'Survey & Feedback', 'Service & Support', 'Login', 'Registration', 'Home', 'General',
] as const;
const CORE = 8;

// First match wins, so "Registration"/"Reset password" come before "Login".
const RULES: [RegExp, string][] = [
  [/registration|reset password/i, 'Registration'],
  [/login|auth\.setup/i, 'Login'],
  [/\bhome\b/i, 'Home'],
  [/event/i, 'Events'],
  [/^chat\b/i, 'Groups & Chat'],
  [/network/i, 'Network'],
  [/mentorship/i, 'Mentorship'],
  [/fundraise|giving|donation/i, 'Fundraise'],
  [/group/i, 'Groups & Chat'],
  [/business/i, 'Business Directory'],
  [/survey|feedback/i, 'Survey & Feedback'],
  [/support|get help/i, 'Service & Support'],
  [/general/i, 'General'],
];

type CaseType = 'Positive' | 'Negative' | 'Positive + Negative' | 'Setup';

// Explicit POSITIVE/NEGATIVE in the title wins; validation/ files are negative; edge cases
// are negative when they check that bad input or a forbidden action is refused.
function typeOf(file: string, title: string): CaseType {
  if (/\.setup\.ts$/.test(file) || /^setup:/i.test(title)) return 'Setup';
  if (/positive/i.test(title) && /negative/i.test(title)) return 'Positive + Negative';
  if (/\bnegative\b/i.test(title)) return 'Negative';
  if (/\bpositive\b/i.test(title)) return 'Positive';
  if (/[\\/]validation[\\/]/.test(file)) return 'Negative';
  if (/reject|cannot|can ?not|not accepted|only be|must|disabled|limit|blank|hostile|sql|script|expired|invalid|below|safely|sideways|confirmation/i.test(title)) return 'Negative';
  return 'Positive';
}

// Skipped = the test called test.skip()/fixme (it carries a "skip" annotation);
// Blocked = never ran because a setup project or an earlier step of its serial flow failed.
type Status = 'Passed' | 'Failed' | 'Known bug' | 'Blocked' | 'Skipped';

type Row = {
  module: string; type: CaseType; file: string; suite: string; title: string; project: string;
  status: Status; duration: number; retries: number; error: string; screenshot: string;
};

// Describe title decides first (files like fundraise-business.edge cover two modules),
// then the file name, then the test title (search-and-chat names the module per test).
function moduleOf(suite: string, file: string, title: string) {
  for (const text of [suite, path.basename(file), title]) {
    if (/search boxes and chat/i.test(text)) continue;
    const hit = RULES.find(([re]) => re.test(text));
    if (hit) return hit[1];
  }
  return 'General';
}

const clean = (s = '') => s.replace(/\u001b\[[0-9;]*m/g, '').trim();

function collect(suite: any, parents: string[], file: string, out: Row[]) {
  const here = suite.title ? [...parents, suite.title] : parents;
  const f = suite.file ?? file;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = t.results?.at(-1);
      const status: Status =
        t.status === 'skipped'
          ? ([...(t.annotations ?? []), ...(last?.annotations ?? [])].some((a: any) => a.type === 'skip' || a.type === 'fixme') ? 'Skipped' : 'Blocked')
        : t.status === 'unexpected' ? 'Failed'
        : t.expectedStatus === 'failed' ? 'Known bug'
        : 'Passed';
      // The top-level suite is the file itself; keep only describe() titles.
      const suiteTitle = here.filter((s) => !/\.ts$/.test(s)).join(' › ');
      out.push({
        module: moduleOf(suiteTitle, f, spec.title),
        type: typeOf(f, spec.title),
        file: f.replace(/\\/g, '/'),
        suite: suiteTitle,
        title: spec.title,
        project: t.projectName,
        status,
        duration: Math.round((last?.duration ?? 0) / 100) / 10,
        retries: Math.max(0, (t.results?.length ?? 1) - 1),
        error: status === 'Failed' ? clean(last?.errors?.[0]?.message ?? last?.error?.message).split('\n').slice(0, 6).join('\n') : '',
        screenshot: last?.attachments?.find((a: any) => a.name === 'screenshot' && a.path)?.path ?? '',
      });
    }
  }
  for (const child of suite.suites ?? []) collect(child, here, f, out);
}

// ---- Styling (matches the team's QA report template) ----
const NAVY = 'FF1F2A4A';
const TEAL = 'FF0B7B85';
const ACCENT = 'FF6B5BD6';
const WHITE = 'FFFFFFFF';
const COLORS: Record<Status, string> = {
  Passed: 'FFE3F4E8', Failed: 'FFFBE1E1', 'Known bug': 'FFFFF1D6', Blocked: 'FFEDE7F6', Skipped: 'FFEFEFF2',
};
const fill = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } }) as const;
const thin = { style: 'thin', color: { argb: 'FFD9DDE3' } } as const;
const border = { top: thin, left: thin, bottom: thin, right: thin } as const;

function styleHeader(row: ExcelJS.Row, from = 1, to = row.cellCount) {
  for (let c = from; c <= to; c++) {
    const cell = row.getCell(c);
    cell.fill = fill(TEAL);
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  }
  row.height = 22;
}

type Tally = { total: number; pos: string; neg: string; passed: number; failed: number; known: number; blocked: number; skipped: number; pct: number | null };

function tally(list: Row[]): Tally {
  const n = (s: Status) => list.filter((r) => r.status === s).length;
  const passed = n('Passed'), failed = n('Failed');
  // "Positive + Negative" tests count towards both columns.
  const of = (k: 'Positive' | 'Negative') => list.filter((r) => r.type === k || r.type === 'Positive + Negative');
  const ratio = (l: Row[]) => `${l.filter((r) => r.status === 'Passed').length} / ${l.length}`;
  return {
    total: list.length, pos: ratio(of('Positive')), neg: ratio(of('Negative')), passed, failed,
    known: n('Known bug'), blocked: n('Blocked'), skipped: n('Skipped'), pct: passed + failed ? passed / (passed + failed) : null,
  };
}

const resultText = (t: Tally) =>
  !t.total ? 'No tests' : t.failed ? 'FAIL' : t.passed ? (t.blocked + t.skipped ? 'PASS (some not run)' : 'PASS') : 'NOT RUN';

type RunInfo = {
  start: string; project: string; environment: string; release: string; tester: string;
  framework: string; date: string; build: string; notes: string;
};

function environmentName() {
  if (process.env.REPORT_ENV) return process.env.REPORT_ENV;
  const host = (() => { try { return new URL(process.env.BASE_URL ?? '').host; } catch { return ''; } })();
  const org = host.match(/--([a-z0-9]+)\./i)?.[1];
  return /sandbox/i.test(host) ? `Sandbox${org ? ` (${org})` : ''}` : host ? 'Production' : '';
}

(async () => {
  if (!fs.existsSync(RESULTS)) {
    console.error(`No ${RESULTS} found. Run the tests first (npx playwright test).`);
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  const rows: Row[] = [];
  for (const s of json.suites ?? []) collect(s, [], s.file, rows);
  rows.sort((a, b) => MODULES.indexOf(a.module as any) - MODULES.indexOf(b.module as any) || a.file.localeCompare(b.file));

  const started = json.stats?.startTime ? new Date(json.stats.startTime) : new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const all = tally(rows);
  const modulesRun = MODULES.filter((m, i) => i < CORE && rows.some((r) => r.module === m));

  // ---- Run history: one row per run (re-generating the same run replaces its row) ----
  const run: RunInfo = {
    start: started.toISOString(),
    project: process.env.REPORT_PROJECT ?? 'Ken42 Alumni Portal',
    environment: environmentName(),
    release: process.env.REPORT_RELEASE ?? '',
    tester: process.env.REPORT_TESTER ?? 'Yukeshwaran',
    framework: process.env.REPORT_FRAMEWORK ?? 'Playwright TS',
    date: `${p2(started.getDate())}/${p2(started.getMonth() + 1)}/${started.getFullYear()}`,
    build: process.env.REPORT_BUILD ?? '',
    notes: process.env.REPORT_NOTES ??
      `${modulesRun.length === CORE ? 'All 8 modules' : modulesRun.join(', ') || 'Login only'} - ${all.total} tests: ${all.passed} passed, ${all.failed} failed, ${all.blocked} blocked, ${all.skipped} skipped`,
  };
  let history: RunInfo[] = [];
  try { history = JSON.parse(fs.readFileSync(HISTORY, 'utf8')); } catch {}
  history = [...history.filter((h) => h.start !== run.start), run].sort((a, b) => a.start.localeCompare(b.start));
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(HISTORY, JSON.stringify(history, null, 2));

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  // ---- Summary ----
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: true }] });
  [28, 18, 20, 16, 16, 14, 14, 34, 12, 10, 22].forEach((w, i) => (sum.getColumn(i + 1).width = w));
  const LAST_COL = 11;

  // Title banner
  sum.mergeCells(1, 1, 1, LAST_COL);
  const title = sum.getCell('A1');
  title.value = 'QA AUTOMATION TEST EXECUTION REPORT';
  title.font = { bold: true, size: 18, color: { argb: WHITE } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 0 };
  for (let c = 1; c <= LAST_COL; c++) {
    sum.getCell(1, c).fill = fill(NAVY);
    sum.getCell(1, c).border = { bottom: { style: 'medium', color: { argb: ACCENT } } };
  }
  sum.getRow(1).height = 40;

  // Metric / Value
  let r = 3;
  sum.getRow(r).values = ['Metric', 'Value'];
  styleHeader(sum.getRow(r), 1, 2);
  const metrics: [string, number | string][] = [
    ['Total Executions', all.total],
    ['Passed', all.passed],
    ['Failed', all.failed],
    ['Blocked', all.blocked],
    ['Skipped', all.skipped],
    ['Known Bug (expected fail)', all.known],
    ['Pass Rate', all.pct ?? '-'],
  ];
  for (const [k, v] of metrics) {
    r++;
    sum.getCell(r, 1).value = k;
    const cell = sum.getCell(r, 2);
    cell.value = v;
    cell.alignment = { horizontal: 'right' };
    if (k === 'Pass Rate' && typeof v === 'number') cell.numFmt = '0%';
    if (k === 'Failed' && all.failed) cell.font = { bold: true, color: { argb: 'FFB00020' } };
    if (k === 'Passed' && all.passed) cell.font = { bold: true, color: { argb: 'FF1B7F3B' } };
  }

  // Run details (history)
  r += 3;
  sum.getRow(r).values = ['PROJECT', 'ENVIRONMENT', 'RELEASE / SPRINT', 'TESTER', 'FRAMEWORK', 'REPORT DATE', 'BUILD', 'NOTES'];
  styleHeader(sum.getRow(r), 1, 8);
  for (const h of history) {
    r++;
    sum.getRow(r).values = [h.project, h.environment, h.release, h.tester, h.framework, h.date, h.build, h.notes];
    sum.getCell(r, 6).alignment = { horizontal: 'right' };
    sum.getCell(r, 8).alignment = { wrapText: true, vertical: 'top' };
    if (h.start === run.start) for (let c = 1; c <= 8; c++) sum.getCell(r, c).fill = fill('FFE8F4F4');
  }

  // Module-wise results
  r += 3;
  sum.getRow(r).values = ['MODULE', 'TOTAL', 'POSITIVE (PASS/TOTAL)', 'NEGATIVE (PASS/TOTAL)', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', 'KNOWN BUG', 'PASS %', 'RESULT'];
  styleHeader(sum.getRow(r), 1, LAST_COL);
  sum.getRow(r).height = 30;
  const moduleRow = (name: string, t: Tally, bold = false) => {
    r++;
    sum.getRow(r).values = [name, t.total, t.pos, t.neg, t.passed, t.failed, t.blocked, t.skipped, t.known, t.pct ?? '-', resultText(t)];
    for (let c = 2; c <= LAST_COL; c++) sum.getCell(r, c).alignment = { horizontal: 'right' };
    if (typeof t.pct === 'number') sum.getCell(r, 10).numFmt = '0%';
    const res = sum.getCell(r, LAST_COL);
    res.alignment = { horizontal: 'center' };
    res.font = { bold: true };
    res.fill = fill(t.failed ? COLORS.Failed : t.passed ? COLORS.Passed : COLORS.Blocked);
    if (t.failed) sum.getCell(r, 6).font = { bold: true, color: { argb: 'FFB00020' } };
    if (bold) for (let c = 1; c <= LAST_COL; c++) {
      const cell = sum.getCell(r, c);
      cell.font = { ...cell.font, bold: true };
      if (c < LAST_COL) cell.fill = fill('FFF1F1F4');
    }
  };
  for (const m of MODULES) {
    const t = tally(rows.filter((x) => x.module === m));
    if (!t.total && MODULES.indexOf(m) >= CORE) continue;
    moduleRow(m, t);
  }
  moduleRow('TOTAL', all, true);

  r += 2;
  sum.getCell(r, 1).value =
    'Blocked = not started because a step it depends on failed (e.g. login setup). Skipped = the test skipped itself (e.g. no data). ' +
    'Pass % = Passed ÷ (Passed + Failed). Known Bug = test marked as an expected failure.';
  sum.getCell(r, 1).font = { italic: true, color: { argb: 'FF666666' }, size: 9 };
  sum.mergeCells(r, 1, r, LAST_COL);
  sum.getCell(r, 1).alignment = { wrapText: true };
  sum.getRow(r).height = 28;

  // ---- Test Cases ----
  const tc = wb.addWorksheet('Test Cases', { views: [{ state: 'frozen', ySplit: 1 }] });
  tc.columns = [
    { header: '#', key: 'n', width: 5 }, { header: 'Module', key: 'module', width: 20 },
    { header: 'Type', key: 'type', width: 18 }, { header: 'Test Case', key: 'title', width: 60 },
    { header: 'Suite', key: 'suite', width: 40 }, { header: 'File', key: 'file', width: 40 },
    { header: 'Status', key: 'status', width: 12 }, { header: 'Duration (s)', key: 'duration', width: 12 },
    { header: 'Retries', key: 'retries', width: 9 }, { header: 'Error', key: 'error', width: 70 },
  ];
  styleHeader(tc.getRow(1));
  rows.forEach((x, i) => {
    const row = tc.addRow({ n: i + 1, ...x, error: x.error.split('\n')[0] });
    row.getCell('status').fill = fill(COLORS[x.status]);
    row.eachCell({ includeEmpty: true }, (c) => { c.border = border; c.alignment = { vertical: 'top', wrapText: true }; });
  });
  tc.autoFilter = { from: 'A1', to: 'J1' };

  // ---- Failures ----
  const fl = wb.addWorksheet('Failures', { views: [{ state: 'frozen', ySplit: 1 }] });
  fl.columns = [
    { header: 'Module', key: 'module', width: 20 }, { header: 'Type', key: 'type', width: 18 },
    { header: 'Test Case', key: 'title', width: 55 }, { header: 'Error', key: 'error', width: 90 },
    { header: 'Screenshot', key: 'screenshot', width: 60 },
  ];
  styleHeader(fl.getRow(1));
  for (const x of rows.filter((y) => y.status === 'Failed')) {
    const row = fl.addRow(x);
    row.eachCell({ includeEmpty: true }, (c) => { c.border = border; c.alignment = { vertical: 'top', wrapText: true }; });
  }
  if (fl.rowCount === 1) fl.addRow({ module: 'No failures' });
  fl.autoFilter = { from: 'A1', to: 'E1' };

  const stamp = `${started.getFullYear()}-${p2(started.getMonth() + 1)}-${p2(started.getDate())}_${p2(started.getHours())}${p2(started.getMinutes())}`;
  const out = path.join('reports', `test-report_${stamp}.xlsx`);
  await wb.xlsx.writeFile(out);

  // ---- Per-module results table in the terminal ----
  const W = [20, 6, 9, 9, 7, 7, 8, 8, 9, 7, 20];
  const line = (cells: (string | number)[]) =>
    '│ ' + cells.map((c, i) => (i ? String(c).padStart(W[i]) : String(c).padEnd(W[i]))).join(' │ ') + ' │';
  const rule = (l: string, m: string, rr: string) => l + W.map((w) => '─'.repeat(w + 2)).join(m) + rr;
  const pct = (t: Tally) => (t.pct === null ? '-' : `${Math.round(t.pct * 100)}%`);
  const cells = (name: string, t: Tally) => [name, t.total, t.pos, t.neg, t.passed, t.failed, t.blocked, t.skipped, t.known, pct(t), resultText(t)];
  console.log(`\nQA AUTOMATION TEST EXECUTION REPORT  (run started ${started.toLocaleString()})`);
  console.log(rule('┌', '┬', '┐'));
  console.log(line(['Module', 'Total', 'Positive', 'Negative', 'Passed', 'Failed', 'Blocked', 'Skipped', 'Known bug', 'Pass %', 'Result']));
  console.log(rule('├', '┼', '┤'));
  for (const m of MODULES) {
    const t = tally(rows.filter((x) => x.module === m));
    if (!t.total && MODULES.indexOf(m) >= CORE) continue;
    console.log(line(cells(m, t)));
  }
  console.log(rule('├', '┼', '┤'));
  console.log(line(cells('TOTAL', all)));
  console.log(rule('└', '┴', '┘'));
  for (const x of rows.filter((y) => y.status === 'Failed' && /\.setup\.ts$/.test(y.file)))
    console.log(`\n!! Login setup failed (${x.title}), so the ${x.module === 'Network' ? 'Network module' : 'modules that need a logged-in user'} did not run. Run: npm run check:login`);
  console.log(`\nExcel report: ${out}`);
})();
