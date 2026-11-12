import { test } from '@playwright/test';

/**
 * Test-case metadata for the execution-results sheet (see utils/caseReporter.ts).
 * Call `tc({...})` at the start of a test and `actual('...')` as it learns what really happened.
 */
export type CaseInfo = {
  id: string;
  module: string;
  scenario: string;
  type: 'Positive' | 'Negative' | 'Mandatory' | 'Boundary' | 'Verification' | 'Security';
  steps: string[];
  data?: unknown;
  expected: string;
};

export function tc(info: CaseInfo) {
  const a = test.info().annotations;
  a.push({ type: 'tc:id', description: info.id });
  a.push({ type: 'tc:module', description: info.module });
  a.push({ type: 'tc:scenario', description: info.scenario });
  a.push({ type: 'tc:type', description: info.type });
  a.push({ type: 'tc:steps', description: info.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') });
  a.push({ type: 'tc:data', description: info.data === undefined ? '-' : typeof info.data === 'string' ? info.data : JSON.stringify(info.data) });
  a.push({ type: 'tc:expected', description: info.expected });
}

/** Record what was actually observed (shown in the "Actual Result" column; several calls are joined). */
export function actual(text: string) {
  test.info().annotations.push({ type: 'tc:actual', description: text });
}

/** Note a behaviour seen while building the suite that looks like a defect. */
export function observed(text: string) {
  test.info().annotations.push({ type: 'Observed 2026-11-12', description: text });
}
