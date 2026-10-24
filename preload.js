const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Map();
ipcRenderer.on('evt', (_e, ch, data) => { for (const fn of listeners.get(ch) || []) try { fn(data); } catch (err) { console.error(err); } });

contextBridge.exposeInMainWorld('mh', {
  // call('channel', arg) -> data, throws Error(message) on failure
  call: async (ch, arg) => {
    const r = await ipcRenderer.invoke(ch, arg);
    if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; }
    return r.data;
  },
  on: (ch, fn) => { if (!listeners.has(ch)) listeners.set(ch, []); listeners.get(ch).push(fn); },
  pathOf: file => webUtils.getPathForFile(file),
});
