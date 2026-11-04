// Most między aplikacją webową a powłoką: window.notujaDesktop.
// Polecenia docierają do strony jako zdarzenie DOM `notuja:command` (wysyłane
// przez proces główny z gestem użytkownika); onCommand słucha tego samego zdarzenia.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const versionArg = process.argv.find((a) => a.startsWith('--notuja-version='));
const version = versionArg ? versionArg.slice('--notuja-version='.length) : '';

function cleanState(state) {
  const s = state && typeof state === 'object' ? state : {};
  const out = { recording: s.recording === true };
  if (typeof s.paused === 'boolean') out.paused = s.paused;
  if (typeof s.elapsedMs === 'number' && Number.isFinite(s.elapsedMs)) out.elapsedMs = Math.max(0, s.elapsedMs);
  if (typeof s.title === 'string') out.title = s.title.slice(0, 200);
  return out;
}

contextBridge.exposeInMainWorld('notujaDesktop', {
  isDesktop: true,
  platform: process.platform,
  version,
  onCommand(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = (event) => {
      const d = event && event.detail;
      if (!d || typeof d.type !== 'string') return;
      if (d.type === 'record') cb({ type: 'record', source: d.source === 'mic' ? 'mic' : 'computer' });
      else if (d.type === 'open') cb({ type: 'open', path: typeof d.path === 'string' ? d.path : '/app' });
      else cb({ type: d.type });
    };
    window.addEventListener('notuja:command', handler);
    return () => window.removeEventListener('notuja:command', handler);
  },
  setState(state) {
    ipcRenderer.send('notuja:state', cleanState(state));
  },
  ready() {
    ipcRenderer.send('notuja:ready');
  },
  /** Powiadomienie systemowe. `path` (np. /app/wyklady/…) otwiera się po kliknięciu; kind 'class' = przypomnienie o zajęciach. */
  notify(n) {
    const s = n && typeof n === 'object' ? n : {};
    if (typeof s.title !== 'string' || !s.title) return;
    ipcRenderer.send('notuja:notify', {
      title: s.title.slice(0, 120),
      body: typeof s.body === 'string' ? s.body.slice(0, 300) : '',
      path: typeof s.path === 'string' && s.path.startsWith('/app') ? s.path.slice(0, 500) : '/app',
      kind: s.kind === 'class' ? 'class' : 'app',
    });
  },
});
