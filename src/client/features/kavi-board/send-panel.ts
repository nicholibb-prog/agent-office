/**
 * Kavi's desk PC: a modal styled like her screen (a FaceTime-like frame with a "Kavi" tag). The
 * owner writes here; each note becomes a packet in the Bridge to-kavi folder, and Kavi's replies
 * come back from to-george into the same thread. Not a live call: there is no typing indicator,
 * and nothing is shown that has not arrived as a file.
 */
import { FACE_SRC } from './picture';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const POLL_MS = 20_000;
export const NOT_LIVE_NOTE = 'Not a live call. Kavi reads the Bridge folder and answers later.';

type Item = { from: 'owner' | 'kavi'; text: string; at: string };
type Thread = { state: string; items: Item[]; driveLink: string };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** "3:41 PM" today, otherwise "Oct 12, 3:41 PM". */
export function timeLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${t}`;
}

const CSS = `
.kavi-open{position:fixed;left:14px;bottom:62px;z-index:1000;padding:8px 12px;border-radius:10px;border:0;background:#2f6f6a;color:#fff;font:600 13px system-ui;cursor:pointer}
.kavi-pc-back{position:fixed;inset:0;z-index:1100;background:#0009;display:none;align-items:center;justify-content:center}
.kavi-pc-back.open{display:flex}
.kavi-pc{width:min(720px,94vw);height:min(560px,90vh);display:flex;flex-direction:column;border-radius:22px;background:#20262b;border:10px solid #3a4148;box-shadow:0 18px 60px #000a;color:#eef;font:14px system-ui;overflow:hidden}
.kavi-pc-top{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#181d21}
.kavi-pc-top img{width:40px;height:40px;border-radius:50%;object-fit:cover;background:#334}
.kavi-tag{font-weight:700;font-size:15px}.kavi-note{color:#f3d58a;font-size:12px}
.kavi-pc-top .x{margin-left:auto;background:#3a4148;border:0;color:#fff;border-radius:50%;width:30px;height:30px;cursor:pointer}
.kavi-thread{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px}
.kavi-msg{max-width:75%;padding:8px 12px;border-radius:16px;white-space:pre-wrap;word-break:break-word}
.kavi-msg.owner{align-self:flex-end;background:#2f7cf6}.kavi-msg.kavi{align-self:flex-start;background:#3a4148}
.kavi-msg .at{display:block;font-size:11px;opacity:.7;margin-top:3px}
.kavi-empty{color:#9ab;text-align:center;margin:auto}
.kavi-status{padding:6px 14px;font-size:12px;color:#bcd;min-height:16px;word-break:break-all}.kavi-status a{color:#9fe3c9}
.kavi-status.err{color:#ff9b8f}
.kavi-compose{display:flex;gap:8px;padding:10px 14px;background:#181d21;align-items:center}
.kavi-compose textarea{flex:1;height:44px;resize:none;border-radius:12px;border:1px solid #445;background:#11161a;color:#eef;padding:8px}
.kavi-compose button{padding:8px 12px;border-radius:12px;border:0;background:#2f6f6a;color:#fff;cursor:pointer}
.kavi-compose input[type=file]{display:none}`;

export interface KaviPc {
  open(): void;
  close(): void;
}

export function mountKaviSendPanel(): KaviPc {
  const style = el('style', '');
  style.textContent = CSS;
  document.head.appendChild(style);

  const opener = el('button', 'kavi-open', "Kavi's screen");
  const back = el('div', 'kavi-pc-back');
  const pc = el('div', 'kavi-pc');
  pc.setAttribute('role', 'dialog');
  pc.setAttribute('aria-modal', 'true');
  pc.setAttribute('aria-label', "Kavi's desk computer");
  const top = el('div', 'kavi-pc-top');
  const face = el('img', '');
  face.src = FACE_SRC;
  face.alt = '';
  const who = el('div', '');
  who.append(el('div', 'kavi-tag', 'Kavi'), el('div', 'kavi-note', NOT_LIVE_NOTE));
  const x = el('button', 'x', '×');
  x.setAttribute('aria-label', 'Close');
  top.append(face, who, x);
  const thread = el('div', 'kavi-thread');
  thread.setAttribute('aria-live', 'polite');
  const status = el('div', 'kavi-status');
  const compose = el('div', 'kavi-compose');
  const text = el('textarea', '');
  text.maxLength = 4000;
  text.placeholder = 'Write to Kavi';
  text.setAttribute('aria-label', 'Message for Kavi');
  const file = el('input', '') as HTMLInputElement;
  file.type = 'file';
  file.accept = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.json,.docx,.xlsx,.pptx';
  const attach = el('button', '', 'Send file');
  const sendBtn = el('button', '', 'Send');
  compose.append(text, file, attach, sendBtn);
  pc.append(top, thread, status, compose);
  back.append(pc);
  document.body.append(opener, back);

  let link = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastFocus: Element | null = null;
  const localFiles: Item[] = [];

  const setStatus = (msg: string, err = false, withLink = false) => {
    status.className = 'kavi-status' + (err ? ' err' : '');
    status.textContent = msg;
    if (withLink && link) {
      status.append(' ');
      const a = el('a', '', 'Open in Drive');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      status.append(a);
    }
  };
  const paint = (items: Item[]) => {
    const all = [...items, ...localFiles].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    thread.replaceChildren();
    if (!all.length) thread.append(el('div', 'kavi-empty', 'No messages yet.'));
    for (const it of all) {
      const m = el('div', `kavi-msg ${it.from}`, it.text);
      m.append(el('span', 'at', `${it.from === 'kavi' ? 'Kavi' : 'You'} · ${timeLabel(it.at)}`));
      thread.append(m);
    }
    thread.scrollTop = thread.scrollHeight;
  };
  const load = () =>
    fetch('/api/kavi/thread', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Thread>) : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        link = t.driveLink || link;
        if (t.state === 'unconfigured') setStatus('The Bridge folder is not set up on this machine yet.', true);
        else if (t.state === 'unreachable') setStatus('The Bridge folder is unreachable.', true);
        paint(t.items || []);
      })
      .catch(() => setStatus('Could not load the thread.', true));
  const done = (r: Response) =>
    r.json().then((j: { name?: string; folderId?: string; error?: string }) => {
      if (r.ok && j.folderId) {
        link = `https://drive.google.com/drive/folders/${encodeURIComponent(j.folderId)}`;
        setStatus(`Sent and confirmed in to-kavi (folder ${j.folderId}).`, false, true);
        return true;
      }
      setStatus(`Not sent: ${j.error || r.status}`, true);
      return false;
    });

  const focusables = () => [...pc.querySelectorAll<HTMLElement>('button, textarea, a[href]')].filter((e) => e.offsetParent !== null);
  const onKey = (e: KeyboardEvent) => {
    if (!back.classList.contains('open')) return;
    e.stopPropagation();
    if (e.key === 'Escape') return close();
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    }
  };
  function open() {
    if (back.classList.contains('open')) return;
    lastFocus = document.activeElement;
    if (document.pointerLockElement) document.exitPointerLock();
    back.classList.add('open');
    setStatus('');
    void load();
    timer = setInterval(() => void load(), POLL_MS);
    text.focus();
  }
  function close() {
    back.classList.remove('open');
    if (timer) clearInterval(timer);
    timer = undefined;
    (lastFocus as HTMLElement | null)?.focus?.();
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', (e) => back.classList.contains('open') && e.stopPropagation(), true);
  back.addEventListener('mousedown', (e) => e.target === back && close());
  opener.onclick = open;
  x.onclick = close;
  sendBtn.onclick = () => {
    const body = text.value.trim();
    if (!body) return;
    sendBtn.disabled = true;
    void fetch('/api/kavi/message', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: body }) })
      .then(done)
      .then((ok) => {
        if (ok) text.value = '';
        return load();
      })
      .catch(() => setStatus('Not sent: the office did not answer.', true))
      .finally(() => (sendBtn.disabled = false));
  };
  attach.onclick = () => file.click();
  file.onchange = () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) return setStatus('Not sent: the file is over 10 MB.', true);
    void fetch('/api/kavi/file', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name) }, body: f })
      .then((r) => r.clone().json().then((j: { name?: string }) => done(r).then((ok) => {
          if (!ok) return;
          localFiles.push({ from: 'owner', text: `Sent a file: ${j.name}`, at: new Date().toISOString() });
          return load();
        })))
      .catch(() => setStatus('Not sent: the office did not answer.', true));
  };
  return { open, close };
}
