// Creates oversized upload fixtures for file-size validation tests (run automatically by the tests if missing).
// The bytes are filler: size checks in the portal run on file.size before the image is decoded.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'tests', 'fixtures');
fs.mkdirSync(dir, { recursive: true });
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const files = [
  ['big-1_5mb.png', 1.5],
  ['big-3mb.png', 3],
  ['big-6mb.png', 6],
  ['big-6mb.pdf', 6],
];
for (const [name, mb] of files) {
  const file = path.join(dir, name);
  if (fs.existsSync(file)) continue;
  const body = Buffer.alloc(Math.round(mb * 1024 * 1024), 0x41);
  const head = name.endsWith('.png') ? PNG_SIGNATURE : Buffer.from('%PDF-1.4\n');
  fs.writeFileSync(file, Buffer.concat([head, body]));
  console.log('created', name);
}
