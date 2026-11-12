/**
 * One command for all 8 modules: Events, Network, Mentorship, Fundraise, Groups & Chat,
 * Business Directory, Survey & Feedback, Service & Support.
 * Runs them in a single Playwright run, then prints a per-module results table and
 * writes the Excel report (scripts/excel-report.ts).
 *
 * Run:  npm run test:all-modules
 *       npm run test:all-modules -- --headed     (extra Playwright options go after --)
 * Hide the browser:  $env:HEADLESS=1; npm run test:all-modules
 */
import { spawnSync } from 'node:child_process';

// events + network + modules projects hold all 8 modules; "setup" (login) runs first automatically.
const PROJECTS = ['events', 'network', 'modules'];

const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;

const testStatus = run('npx', ['playwright', 'test', ...PROJECTS.map((p) => `--project=${p}`), ...process.argv.slice(2)]);
run('npx', ['tsx', 'scripts/excel-report.ts']);
console.log('HTML report with screenshots and videos: npm run report\n');
process.exit(testStatus);
