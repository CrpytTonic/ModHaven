// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Run with: electron tools/make-icon.js  -> app/icon.png + app/icon.ico (PNG-in-ICO, 16..256)
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b6bff"/><stop offset="1" stop-color="#3e8ef7"/></linearGradient></defs><path d="M16 1.5 29 9v14L16 30.5 3 23V9z" fill="url(#g)"/><path d="M10 12l6-3.5 6 3.5v8l-6 3.5-6-3.5z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M16 15.5v8M10 12l6 3.5 6-3.5" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('data:text/html,<canvas></canvas>');
  const sizes = [256, 64, 48, 32, 16];
  const pngs = [];
  for (const s of sizes) {
    const url = await w.webContents.executeJavaScript(`new Promise(r=>{const i=new Image();i.onload=()=>{const c=document.querySelector('canvas');c.width=c.height=${s};const x=c.getContext('2d');x.clearRect(0,0,${s},${s});x.drawImage(i,0,0,${s},${s});r(c.toDataURL('image/png'))};i.src='data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}'})`);
    pngs.push(Buffer.from(url.split(',')[1], 'base64'));
  }
  fs.writeFileSync(path.join(__dirname, '..', 'app', 'icon.png'), pngs[0]);
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(off, e + 12);
    off += pngs[i].length;
  });
  fs.writeFileSync(path.join(__dirname, '..', 'app', 'icon.ico'), Buffer.concat([head, ...pngs]));
  app.quit();
});
