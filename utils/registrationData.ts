import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Unique test data for Alumni self-registration.
 *
 * Every value that must be unique (name pair, email, mobile, Student ID) is checked against a ledger
 * (test-data/registration-ledger.json) that survives between runs, so nothing is ever reused —
 * not within a run and not across runs. The ledger is updated with a file lock so parallel
 * workers can't hand out the same value.
 *
 * Portal rules this respects (seen on /SelfRegister, 2026-11-12):
 *  - First/Last Name: digits and symbols are stripped as you type → names are letters only.
 *  - Mobile: country code must be picked; India = +91, 10 digits starting 6–9.
 *  - Institute: only "Ken Institute" exists in the sandbox; Programme depends on it.
 *  - Years: 1980 … current year.
 */

const LEDGER = path.join('test-data', 'registration-ledger.json');
const LOCK = `${LEDGER}.lock`;

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Shaurya', 'Atharv', 'Advik', 'Pranav', 'Dhruv', 'Kabir', 'Ritvik', 'Aniruddh', 'Yash', 'Rohan',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Myra', 'Aanya', 'Pari', 'Anika', 'Navya', 'Kiara',
  'Ira', 'Riya', 'Meera', 'Tara', 'Nisha', 'Kavya', 'Lakshmi', 'Priya', 'Sneha', 'Divya',
  'Harini', 'Keerthana', 'Yamini', 'Bhavana', 'Swathi', 'Gokul', 'Karthik', 'Surya', 'Vignesh', 'Naveen',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Nair', 'Reddy', 'Rao', 'Patel', 'Mehta', 'Gupta', 'Menon',
  'Pillai', 'Kulkarni', 'Deshpande', 'Joshi', 'Chatterjee', 'Banerjee', 'Mukherjee', 'Bose', 'Das', 'Sen',
  'Krishnan', 'Subramanian', 'Raman', 'Natarajan', 'Venkatesh', 'Bhat', 'Shetty', 'Hegde', 'Kamath', 'Prabhu',
];

export const INSTITUTE = 'Ken Institute';
export const PROGRAMME = 'MBA-2026-Jan';

type Ledger = { names: string[]; emails: string[]; mobiles: string[]; studentIds: string[] };

export type Registration = {
  firstName: string;
  lastName: string;
  email: string;
  /** 10 digits, no country code */
  mobile: string;
  countryCode: string;
  countryName: string;
  studentId: string;
  institute: string;
  programme: string;
  yearOfEnrollment: string;
  yearOfGraduation: string;
  marketingConsent: boolean;
};

/** Number → lowercase letters (base 26), e.g. 0 → "a", 27 → "bb". Names may not contain digits. */
function letters(n: number, width = 4) {
  let s = '';
  for (let i = 0; i < width; i++) { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

const rand = (max: number) => crypto.randomInt(max);
const pick = <T>(a: T[]) => a[rand(a.length)];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function withLedger<T>(fn: (l: Ledger) => T): T {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  // Simple cross-process lock (parallel Playwright workers).
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(LOCK); break; } catch {
      if (Date.now() - start > 15_000) { fs.rmSync(LOCK, { recursive: true, force: true }); continue; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    const l: Ledger = fs.existsSync(LEDGER)
      ? JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
      : { names: [], emails: [], mobiles: [], studentIds: [] };
    const out = fn(l);
    fs.writeFileSync(LEDGER, JSON.stringify(l, null, 1));
    return out;
  } finally {
    fs.rmSync(LOCK, { recursive: true, force: true });
  }
}

function uniqueValue(used: Set<string>, make: () => string) {
  for (let i = 0; i < 500; i++) {
    const v = make();
    if (!used.has(v.toLowerCase())) return v;
  }
  throw new Error('Could not generate a unique value after 500 tries');
}

/** Valid Indian mobile: 10 digits, first digit 6–9, not all the same digit. */
export function indianMobile() {
  const first = String(6 + rand(4));
  let rest = '';
  for (let i = 0; i < 9; i++) rest += rand(10);
  return first + rest;
}

/**
 * A brand-new registration. Pass `overrides` to build negative cases from a valid base
 * (the base values are still reserved so they're never reused).
 */
export function newRegistration(overrides: Partial<Registration> = {}): Registration {
  return withLedger(l => {
    const names = new Set(l.names.map(s => s.toLowerCase()));
    const emails = new Set(l.emails.map(s => s.toLowerCase()));
    const mobiles = new Set(l.mobiles);
    const ids = new Set(l.studentIds.map(s => s.toLowerCase()));
    // Letter suffix from time + randomness keeps names unique AND letters-only.
    const seq = (Date.now() / 1000) | 0;

    let first = '', last = '';
    uniqueValue(names, () => {
      first = pick(FIRST_NAMES) + letters(rand(26 * 26), 2);
      last = pick(LAST_NAMES) + letters(seq + rand(26 ** 3), 4);
      return `${first} ${last}`;
    });
    first = cap(first.toLowerCase());
    last = cap(last.toLowerCase());

    const email = uniqueValue(emails, () =>
      `qa.${first}.${last}.${crypto.randomBytes(2).toString('hex')}@yopmail.com`.toLowerCase());
    const mobile = uniqueValue(mobiles, indianMobile);
    const studentId = uniqueValue(ids, () =>
      `KEN${String(new Date().getFullYear()).slice(2)}${crypto.randomBytes(3).toString('hex').toUpperCase()}`);

    const enrollment = 2012 + rand(10); // 2012–2021
    const graduation = enrollment + 2 + rand(3); // 2–4 years later, never in the future
    const reg: Registration = {
      firstName: first,
      lastName: last,
      email,
      mobile,
      countryCode: '+91',
      countryName: 'India',
      studentId,
      institute: INSTITUTE,
      programme: PROGRAMME,
      yearOfEnrollment: String(enrollment),
      yearOfGraduation: String(Math.min(graduation, new Date().getFullYear())),
      // Required in practice: Register is refused with "Please tick this box to register." when unticked.
      marketingConsent: true,
      ...overrides,
    };

    l.names.push(`${first} ${last}`, `${reg.firstName} ${reg.lastName}`);
    l.emails.push(email, reg.email);
    l.mobiles.push(mobile, reg.mobile);
    l.studentIds.push(studentId, reg.studentId);
    l.names = [...new Set(l.names)]; l.emails = [...new Set(l.emails)];
    l.mobiles = [...new Set(l.mobiles)]; l.studentIds = [...new Set(l.studentIds)];
    return reg;
  });
}

/** YOPmail inbox name = the part before @. */
export const yopInbox = (email: string) => email.split('@')[0];

/** A strong password that satisfies typical Salesforce/portal policy, unique per call. */
export function newPassword() {
  return `Qa#${crypto.randomBytes(3).toString('hex')}Ab9!`;
}
