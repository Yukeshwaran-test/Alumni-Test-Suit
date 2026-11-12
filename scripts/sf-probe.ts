import fs from 'node:fs';
if (fs.existsSync('.env')) process.loadEnvFile('.env');
import { sfGet, sfQuery } from '../utils/salesforce';
(async () => {
  const arg = process.argv[2];
  if (arg === 'objects') {
    const d = await sfGet('/sobjects');
    console.log(d.sobjects.filter((o: any) => /regist|master|alumn|onboard|magic/i.test(o.name + o.label)).map((o: any) => `${o.name} | ${o.label}`).join('\n'));
  } else if (arg === 'describe') {
    const d = await sfGet(`/sobjects/${process.argv[3]}/describe`);
    console.log(d.fields.map((f: any) => `${f.name} | ${f.label} | ${f.type} | ${f.length} | nillable=${f.nillable}`).join('\n'));
  } else if (arg === 'q') {
    console.log(JSON.stringify(await sfQuery(process.argv[3]), null, 1));
  } else if (arg === 'tabs') {
    const d = await sfGet('/tabs');
    console.log(d.filter((t: any) => /regist|master/i.test(t.label + t.name)).map((t: any) => `${t.label} | ${t.name} | ${t.sobjectName} | ${t.url}`).join('\n'));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
