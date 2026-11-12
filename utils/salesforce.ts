import fs from 'node:fs';
import { SF_AUTH_FILE } from '../playwright.config';

/**
 * Read-only Salesforce REST helper. Reuses the Lightning session saved by `npm run sf:login`
 * (its `sid` cookie works as an API bearer token), so no connected app is needed.
 */
const API = '/services/data/v62.0';

function session() {
  if (!fs.existsSync(SF_AUTH_FILE)) return null;
  const state = JSON.parse(fs.readFileSync(SF_AUTH_FILE, 'utf8'));
  const sid = state.cookies.find((c: any) => c.name === 'sid' && /my\.salesforce\.com$/.test(c.domain));
  return sid ? { host: `https://${sid.domain.replace(/^\./, '')}`, token: sid.value as string } : null;
}

export const lightningUrl = () => process.env.SF_URL!.replace('.my.salesforce.com', '.lightning.force.com');

export async function sfGet<T = any>(path: string): Promise<T> {
  const s = session();
  if (!s) throw new Error(`No Salesforce session in ${SF_AUTH_FILE}. Run: npm run sf:login`);
  const res = await fetch(s.host + API + path, { headers: { Authorization: `Bearer ${s.token}` } });
  if (!res.ok) throw new Error(`Salesforce ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export async function sfQuery<T = any>(soql: string): Promise<T[]> {
  return (await sfGet<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;
}

/** True when .auth/sf.json holds a session Salesforce still accepts. */
export async function hasSfSession() {
  try {
    await sfQuery('SELECT Id FROM User LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function findEventByTitle(title: string) {
  const [rec] = await sfQuery(
    `SELECT Id, Name, Event_Status__c, Is_Published__c, Event_Type__c, Start_Date__c, End_Date__c,
            Offer_Meals__c, Dietary_Preferences__c, Can_Alumni_Bring_Guests__c, Guest_Count__c,
            Description__c, What_to_Expect_From_Event__c, Segmentation__c
       FROM Ken_Event_Master__c WHERE Name = '${esc(title)}' ORDER BY CreatedDate DESC LIMIT 1`,
  );
  return rec;
}

export async function sessionsForEvent(eventId: string) {
  return sfQuery(
    `SELECT Id, Name, Start_DateTime__c, End_DateTime__c, Location_Type__c, Session_Link__c, Meals__c,
            Feedback_Trigger_Type__c, Feedback_Trigger_When__c
       FROM Ken_Schedule_Sessions__c WHERE Event_Reference__c = '${eventId}'`,
  );
}

export async function pendingApproval(eventId: string) {
  const [item] = await sfQuery(
    `SELECT Id, Actor.Name, ProcessInstance.Status, ProcessInstance.ProcessDefinition.Name
       FROM ProcessInstanceWorkitem WHERE ProcessInstance.TargetObjectId = '${eventId}'`,
  );
  return item;
}

export async function surveysForEvent(eventId: string) {
  return sfQuery(`SELECT Id, Name FROM Ken_Survey__c WHERE Event__c = '${eventId}'`);
}

// ---------- Network module ----------

/** Portal user's Account (person account) and Contact, looked up by login email. */
export async function alumnusByEmail(email: string) {
  const [u] = await sfQuery<{ Id: string; Name: string; AccountId: string; ContactId: string }>(
    `SELECT Id, Name, AccountId, ContactId FROM User WHERE Email = '${esc(email)}' AND ContactId != null AND IsActive = true LIMIT 1`,
  );
  if (!u) throw new Error(`No active portal user with email ${email}`);
  return u;
}

export type NetworkConnection = {
  Id: string; Name: string; Status__c: string;
  Initiator__c: string; Recipient__c: string;
  Requested_Date__c: string | null; Accepted_Date__c: string | null; LastModifiedDate: string;
};

/** The single Ken_Network_Connection__c record between two accounts (either direction). */
export async function connectionBetween(accountA: string, accountB: string) {
  const [c] = await sfQuery<NetworkConnection>(
    `SELECT Id, Name, Status__c, Initiator__c, Recipient__c, Requested_Date__c, Accepted_Date__c, LastModifiedDate
       FROM Ken_Network_Connection__c
      WHERE (Initiator__c = '${accountA}' AND Recipient__c = '${accountB}')
         OR (Initiator__c = '${accountB}' AND Recipient__c = '${accountA}')
      ORDER BY LastModifiedDate DESC LIMIT 1`,
  );
  return c;
}

/** Ken_Notification__c records about connections created after `sinceIso`. */
export async function connectionNotificationsSince(sinceIso: string) {
  return sfQuery(
    `SELECT Id, Title__c, Type__c, Category__c, Recipient__c, CreatedDate
       FROM Ken_Notification__c
      WHERE CreatedDate > ${sinceIso} ORDER BY CreatedDate DESC LIMIT 20`,
  ).then(rows => rows.filter((n: any) => /connect/i.test(`${n.Title__c} ${n.Type__c} ${n.Category__c}`)));
}

/** Ken_Chat_Message__c records sent by a contact after `sinceIso`. */
export async function chatMessagesSince(senderContactId: string, sinceIso: string) {
  return sfQuery(
    `SELECT Id, Name, Thread__c, Sender__c, Sent_At__c FROM Ken_Chat_Message__c
      WHERE Sender__c = '${senderContactId}' AND CreatedDate > ${sinceIso} ORDER BY CreatedDate DESC`,
  );
}

/**
 * Delete test records from the Salesforce backend (used for cleanup after a run).
 * Returns what was deleted so it can be attached to the report.
 */
export async function sfDelete(object: string, ids: string[]) {
  const s = session();
  if (!s) throw new Error(`No Salesforce session in ${SF_AUTH_FILE}. Run: npm run sf:login`);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids.filter(Boolean)) {
    const res = await fetch(`${s.host}${API}/sobjects/${object}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${s.token}` } });
    results.push({ id, ok: res.status === 204 || res.status === 404, error: res.ok ? undefined : (await res.text()).slice(0, 200) });
  }
  return { object, results };
}

// ---------- Service & Support ----------

export type AlumniService = {
  id: string; name: string; category: string | null;
  offerings: { id: string; name: string; questionnaire: string | null; questions: string[] }[];
};

/**
 * Services an alumnus should see under "Request for a Service" (reference data from Salesforce):
 * Ken_Service__c whose Target Audience includes Alumni (or category Alumni), with their
 * Ken_Service_Offering__c records and each offering's questionnaire questions.
 */
export async function alumniServicesFromSf(): Promise<AlumniService[]> {
  const services = (await sfQuery(`SELECT Id, Name, Service_Category__c, Target_Audience__c FROM Ken_Service__c ORDER BY Name`))
    .filter((s: any) => /Alumni|All/.test(s.Target_Audience__c ?? '') || s.Service_Category__c === 'Alumni');
  if (!services.length) return [];
  const ids = services.map((s: any) => `'${s.Id}'`).join(',');
  const offerings = await sfQuery(`SELECT Id, Name, Service__c, Questionnaire__c, Questionnaire__r.Name FROM Ken_Service_Offering__c WHERE Service__c IN (${ids}) ORDER BY Name`);
  const qIds = [...new Set(offerings.map((o: any) => o.Questionnaire__c).filter(Boolean))];
  const questions = qIds.length
    ? await sfQuery(`SELECT Questionnaire__c, Question_Label__c FROM Ken_Questionnaire_Parameter__c WHERE Questionnaire__c IN (${qIds.map(i => `'${i}'`).join(',')}) ORDER BY Order__c`)
    : [];
  return services.map((s: any) => ({
    id: s.Id,
    name: s.Name,
    category: s.Service_Category__c,
    offerings: offerings.filter((o: any) => o.Service__c === s.Id).map((o: any) => ({
      id: o.Id,
      name: o.Name,
      questionnaire: o.Questionnaire__r?.Name ?? null,
      questions: questions.filter((q: any) => q.Questionnaire__c === o.Questionnaire__c).map((q: any) => q.Question_Label__c),
    })),
  }));
}

/** Update fields on one of this run's own test records (e.g. move a test survey's end date into the past). */
export async function sfUpdate(object: string, id: string, fields: Record<string, unknown>) {
  const s = session();
  if (!s) throw new Error(`No Salesforce session in ${SF_AUTH_FILE}. Run: npm run sf:login`);
  const res = await fetch(`${s.host}${API}/sobjects/${object}/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (res.status !== 204) throw new Error(`Salesforce update ${object}/${id} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/** The pending approval work item (if any) for any record. */
export async function pendingWorkItem(recordId: string) {
  const [item] = await sfQuery<{ Id: string; ProcessInstance: { Status: string; ProcessDefinition: { Name: string } } }>(
    `SELECT Id, ProcessInstance.Status, ProcessInstance.ProcessDefinition.Name
       FROM ProcessInstanceWorkitem WHERE ProcessInstance.TargetObjectId = '${recordId}'`,
  );
  return item;
}

/** SOQL datetime literal (no quotes) for "now", minus a small clock-skew allowance. */
export function sfNow(skewSeconds = 60) {
  return new Date(Date.now() - skewSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---------- Alumni Registration ----------

/**
 * Object behind Salesforce "Master Records → Registered Records". Set SF_REGISTRATION_OBJECT in .env
 * once known (e.g. Ken_Registered_Record__c); until then the record is found by searching every
 * searchable object for the registration email (SOSL).
 */
export async function findRegisteredRecord(email: string): Promise<{ object: string; record: Record<string, any> } | null> {
  const obj = process.env.SF_REGISTRATION_OBJECT;
  if (obj) {
    const d = await sfGet(`/sobjects/${obj}/describe`);
    const emailField = d.fields.find((f: any) => f.type === 'email')?.name;
    if (!emailField) throw new Error(`${obj} has no email field`);
    const fields = d.fields.filter((f: any) => !['base64', 'address', 'location'].includes(f.type)).map((f: any) => f.name).slice(0, 150);
    const [rec] = await sfQuery(`SELECT ${fields.join(',')} FROM ${obj} WHERE ${emailField} = '${esc(email)}' ORDER BY CreatedDate DESC LIMIT 1`);
    return rec ? { object: obj, record: rec } : null;
  }
  const res = await sfGet<{ searchRecords: { attributes: { type: string; url: string }; Id: string }[] }>(
    `/search/?q=${encodeURIComponent(`FIND {${email.replace(/([?&|!{}[\]()^~*:\\"'+-])/g, '\$1')}} IN EMAIL FIELDS`)}`);
  const hits = res.searchRecords ?? [];
  // Prefer a custom "registration"-like object over standard Contact/Lead/User.
  const ranked = [...hits].sort((a, b) => score(b.attributes.type) - score(a.attributes.type));
  if (!ranked.length) return null;
  const top = ranked[0];
  return { object: top.attributes.type, record: await sfGet(top.attributes.url.replace(/^\/services\/data\/v[\d.]+/, '')) };
}
const score = (t: string) => (/regist/i.test(t) ? 3 : /__c$/.test(t) ? 2 : /Contact|Lead/.test(t) ? 1 : 0);

/** All objects that hold the email (for the report). */
export async function recordsWithEmail(email: string) {
  const res = await sfGet<{ searchRecords: { attributes: { type: string }; Id: string }[] }>(
    `/search/?q=${encodeURIComponent(`FIND {${email.replace(/([?&|!{}[\]()^~*:\\"'+-])/g, '\$1')}} IN EMAIL FIELDS`)}`);
  return (res.searchRecords ?? []).map(r => `${r.attributes.type}:${r.Id}`);
}
