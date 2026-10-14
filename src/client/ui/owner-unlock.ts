// The owner unlock, shared: the same POST /api/bridge/okkin/owner/unlock Okkin's panel uses.
// The passphrase is never stored in the page. On success the caller reloads its own window.
import { UNLOCK_OWNER_LABEL } from '../../shared/privacy-view.js';
import { setOwner } from './owner-state.js';

export async function unlockOwner(passphrase: string): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch('/api/bridge/okkin/owner/unlock', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase }) });
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (r.status === 200) setOwner(true);
  return { ok: r.status === 200, error: r.status === 200 ? undefined : body.error ?? (r.status === 401 ? 'Session expired, sign in again' : 'refused') };
}

const CSS = `.own-unlock{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.own-unlock input{flex:1;min-width:10rem;padding:4px 8px;border-radius:8px;border:1px solid #889;font:inherit}
.own-unlock button{padding:4px 10px;border-radius:8px;border:1px solid #556;background:#e9ecef;color:#223;font:600 12px system-ui;cursor:pointer}
.own-unlock .own-err{color:#9aa0a6;font-size:12px;width:100%}`;
let styled = false;

/** "Unlock owner" button that opens a passphrase field in place, then calls onUnlocked(). */
export function unlockOwnerControl(onUnlocked: () => void): HTMLElement {
  if (!styled && typeof document !== 'undefined') {
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.append(s);
    styled = true;
  }
  const wrap = document.createElement('div');
  wrap.className = 'own-unlock';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = UNLOCK_OWNER_LABEL;
  wrap.append(open);
  open.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.placeholder = 'Owner passphrase';
    input.setAttribute('aria-label', 'Owner passphrase');
    input.maxLength = 1024;
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = UNLOCK_OWNER_LABEL;
    const err = document.createElement('span');
    err.className = 'own-err';
    const submit = () => {
      const p = input.value;
      input.value = '';
      if (!p) return;
      void unlockOwner(p).then((r) => (r.ok ? onUnlocked() : (err.textContent = `Unlock: ${r.error}`)));
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }
    });
    wrap.replaceChildren(input, go, err);
    input.focus();
  });
  return wrap;
}
