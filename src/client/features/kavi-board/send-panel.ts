/**
 * "Write to Kavi": a small panel that drops a note or a file into the Bridge folder's to-kavi path.
 * Not a live call: Kavi answers later through the Bridge. Nothing here invents a reply.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const NOT_LIVE_NOTE = 'Not a live call. Kavi reads the Bridge folder and answers later.';

type ReadBack = { configured: boolean; folderId: string | null; verified: boolean };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function mountKaviSendPanel() {
  const style = el('style', '');
  style.textContent = `
.kavi-open{position:fixed;left:14px;bottom:62px;z-index:1000;padding:8px 12px;border-radius:10px;border:0;background:#2f6f6a;color:#fff;font:600 13px system-ui;cursor:pointer}
.kavi-panel{position:fixed;left:14px;bottom:104px;z-index:1001;width:320px;padding:12px;border-radius:12px;background:#1d2326;color:#eef;font:13px system-ui;box-shadow:0 6px 24px #0008;display:none}
.kavi-panel.open{display:block}.kavi-panel h3{margin:0 0 6px;font-size:14px}
.kavi-note{color:#f3d58a;margin:0 0 8px}.kavi-panel textarea{width:100%;height:80px;box-sizing:border-box;border-radius:8px;border:1px solid #445;background:#11161a;color:#eef;padding:6px}
.kavi-row{display:flex;gap:6px;margin-top:6px;align-items:center}.kavi-row button{padding:6px 10px;border-radius:8px;border:0;background:#2f6f6a;color:#fff;cursor:pointer}
.kavi-status{margin-top:8px;color:#bcd;word-break:break-all}.kavi-id{font-family:ui-monospace,monospace;color:#9fe3c9}`;
  document.head.appendChild(style);
  const open = el('button', 'kavi-open', 'Write to Kavi');
  const panel = el('div', 'kavi-panel');
  panel.append(el('h3', '', 'Kavi — Bridge folder'), el('p', 'kavi-note', NOT_LIVE_NOTE));
  const text = el('textarea', '');
  text.maxLength = 4000;
  text.placeholder = 'Message for Kavi';
  const sendText = el('button', '', 'Send note');
  const file = el('input', '') as HTMLInputElement;
  file.type = 'file';
  file.accept = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.json,.docx,.xlsx,.pptx';
  const sendFileBtn = el('button', '', 'Send file');
  const status = el('div', 'kavi-status');
  const row1 = el('div', 'kavi-row');
  row1.append(sendText);
  const row2 = el('div', 'kavi-row');
  row2.append(file, sendFileBtn);
  panel.append(text, row1, row2, status);
  document.body.append(open, panel);

  const show = (msg: string, id?: string | null) => {
    status.textContent = msg;
    if (id) {
      status.append(document.createElement('br'), 'Parent folder id: ');
      status.append(el('span', 'kavi-id', id));
    }
  };
  const refresh = () =>
    fetch('/api/kavi/bridge', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<ReadBack>) : null))
      .then((b) => {
        if (!b) return show('Bridge status unavailable.');
        if (!b.configured) return show('Bridge folder not set up on this machine yet.');
        if (!b.verified) return show('Bridge folder id did not read back. Sending is off.');
        show('Bridge ready.', b.folderId);
      })
      .catch(() => show('Bridge status unavailable.'));
  const done = (r: Response) =>
    r.json().then((j: { name?: string; folderId?: string; error?: string }) =>
      r.ok ? show(`Sent to to-kavi as ${j.name}. ${NOT_LIVE_NOTE}`, j.folderId) : show(`Not sent: ${j.error || r.status}`),
    );
  open.onclick = () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) void refresh();
  };
  sendText.onclick = () => {
    if (!text.value.trim()) return;
    void fetch('/api/kavi/message', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text.value }) })
      .then(done)
      .then(() => (text.value = ''))
      .catch(() => show('Not sent: the office did not answer.'));
  };
  sendFileBtn.onclick = () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) return show('Not sent: file is over 10 MB.');
    void fetch('/api/kavi/file', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name) }, body: f })
      .then(done)
      .catch(() => show('Not sent: the office did not answer.'));
  };
}
