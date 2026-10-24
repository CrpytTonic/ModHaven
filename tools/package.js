// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Builds the portable app into dist\ModHaven-win32-x64 without touching "ModHaven Data".
// Packs to dist-stage first, then swaps the program files in.
const path = require('path');
const fs = require('fs');
const { packager } = require('@electron/packager');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'dist-stage');
const DIST = path.join(ROOT, 'dist', 'ModHaven-win32-x64');
const KEEP = 'ModHaven Data';

(async () => {
  fs.rmSync(STAGE, { recursive: true, force: true });
  const [out] = await packager({
    dir: ROOT, out: STAGE, name: 'ModHaven', platform: 'win32', arch: 'x64', overwrite: true,
    icon: path.join(ROOT, 'app', 'icon.ico'), asar: { unpack: '**/node_modules/7zip-bin/**' },
    appCopyright: 'Copyright (c) 2026 CrpytTonic. All rights reserved.', win32metadata: { CompanyName: 'CrpytTonic', FileDescription: 'ModHaven mod manager by CrpytTonic', ProductName: 'ModHaven', InternalName: 'ModHaven', OriginalFilename: 'ModHaven.exe' },
    ignore: [/^\/dist/, /^\/dist-stage/, /^\/ModHaven Data/, /^\/tools/, /^\/backups/, /\.log$/, /node_modules\/(electron|@electron|marked|dompurify)\//],
  });
  fs.mkdirSync(DIST, { recursive: true });
  for (const e of fs.readdirSync(DIST)) if (e !== KEEP) fs.rmSync(path.join(DIST, e), { recursive: true, force: true });
  for (const e of fs.readdirSync(out)) fs.cpSync(path.join(out, e), path.join(DIST, e), { recursive: true });
  fs.rmSync(STAGE, { recursive: true, force: true });
  console.log('Built', path.join(DIST, 'ModHaven.exe'));
})().catch(e => { console.error(e); process.exit(1); });
