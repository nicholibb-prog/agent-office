// Owner-only windows follow-up: unlock reuse, locked input, friendly names, idle-timeout keep, Kavi sends, 401 text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  KAVI_PRIVATE_NOTE, KAVI_SENT_PRIVATE_NOTE, PRIVATE_NOTE_GREY, SESSION_EXPIRED_NOTE,
  crewName, deskName, friendlyOutbox, kaviPrivateView, keepOnLock, loadFailNote, outboxTitle,
} from '../src/shared/privacy-view.js';
import { CREW_PRIVATE_NOTE, UNMAPPED_SEAT_LABEL, outboxView } from '../src/shared/hq.js';

const src = (...p: string[]) => readFileSync(path.join(import.meta.dirname, '..', 'src', ...p), 'utf8');

test('401 says "Session expired, sign in again"; other failures keep their own text', () => {
  assert.equal(SESSION_EXPIRED_NOTE, 'Session expired, sign in again');
  assert.equal(loadFailNote(401, 'Could not load the thread.'), SESSION_EXPIRED_NOTE);
  assert.equal(loadFailNote(500, 'Could not load the thread.'), 'Could not load the thread.');
  assert.equal(loadFailNote(undefined, 'x'), 'x');
  const panel = src('client', 'features', 'kavi-board', 'send-panel.ts');
  assert.match(panel, /loadFailNote\(e\?\.status, 'Could not load the thread\.'\)/);
  assert.match(panel, /r\.status === 401 \? loadFailNote\(401/);
  assert.match(src('client', 'features', 'hq', 'index.ts'), /loadFailNote\(err instanceof HttpError/);
});

test('friendly names: roster names for crew seats, layout labels for desks; placeholders only', () => {
  const names = { 'seat-1': 'Placeholder One', 'seat-2': '  ' };
  assert.equal(crewName('seat-1', names), 'Placeholder One');
  assert.equal(crewName('seat-2', names), 'seat-2');
  assert.equal(crewName('okkin'), 'Okkin');
  assert.equal(crewName(null, names), UNMAPPED_SEAT_LABEL);
  assert.equal(deskName('desk-1'), 'Desk 1');
  assert.equal(deskName('meeting-room'), 'Meeting room');
  assert.equal(deskName('no-such-desk'), 'no-such-desk');
  assert.equal(outboxTitle('seat:floor-1:desk-3'), 'Desk 3 turn');
  assert.equal(outboxTitle('reply:floor-1:meeting-room'), 'Meeting room reply');
  assert.equal(outboxTitle('office-chat'), 'office-chat');
  const rows = friendlyOutbox(outboxView({ private: false, items: [
    { title: 'seat:floor-1:desk-1', text: 'p', at: 'a', seat: 'seat-1' },
    { title: 'seat:floor-1:desk-3', text: 'p', at: 'b', seat: null },
  ] }).rows, names);
  assert.deepEqual(rows.map((r) => [r.label, r.who, r.raw]), [['Desk 1 turn', 'Placeholder One', 'seat:floor-1:desk-1'], ['Desk 3 turn', UNMAPPED_SEAT_LABEL, 'seat:floor-1:desk-3']]);
});

test('idle timeout: the last thread stays on screen with the private note above it', () => {
  const prev = [{ id: '1', text: 'placeholder line' }];
  assert.deepEqual(keepOnLock(prev, { private: true, items: [] }, CREW_PRIVATE_NOTE), { items: prev, note: CREW_PRIVATE_NOTE, stale: true });
  assert.deepEqual(keepOnLock([], { private: true, items: [] }, CREW_PRIVATE_NOTE), { items: [], note: CREW_PRIVATE_NOTE, stale: false });
  const fresh = [{ id: '2', text: 'placeholder new' }];
  assert.deepEqual(keepOnLock(prev, { private: false, items: fresh }, CREW_PRIVATE_NOTE), { items: fresh, note: null, stale: false });
  // Owner timeout length is unchanged (15 min idle, 1 h max).
  const owner = src('server', 'hq', 'okkin-owner.ts');
  assert.match(owner, /OWNER_IDLE_MS = 15 \* 60_000;/);
});

test('Kavi: a non-owner keeps their own sends with "Sent. Only the owner can see the thread"', () => {
  const sent = [{ from: 'owner', text: 'placeholder send' }];
  assert.deepEqual(kaviPrivateView([], sent, true), { items: sent, note: KAVI_SENT_PRIVATE_NOTE });
  assert.deepEqual(kaviPrivateView([], [], true), { items: [], note: KAVI_PRIVATE_NOTE });
  const owned = [{ from: 'kavi', text: 'placeholder reply' }];
  assert.deepEqual(kaviPrivateView(owned, sent, true), { items: [...owned, ...sent], note: KAVI_PRIVATE_NOTE });
  assert.equal(KAVI_SENT_PRIVATE_NOTE, 'Sent. Only the owner can see the thread');
});

test('private notes are neutral grey everywhere (never the error class)', () => {
  assert.equal(PRIVATE_NOTE_GREY, '#9aa0a6');
  const panel = src('client', 'features', 'kavi-board', 'send-panel.ts');
  assert.match(panel, /\.kavi-status\.priv\{color:\$\{PRIVATE_NOTE_GREY\}/);
  assert.match(panel, /setStatus\(v\.note \?\? '', 'priv'\)/);
  assert.ok(!/private — unlock owner to see it\.', true\)/.test(panel), 'no private note in the error style');
  assert.match(src('client', 'features', 'hq', 'ui.css'), /\.hq-private \{[^}]*color: #9aa0a6/);
});

test('Unlock owner reuses the Okkin unlock flow in talk, Kavi thread and outbox', () => {
  const shared = src('client', 'ui', 'owner-unlock.ts');
  assert.match(shared, /\/api\/bridge\/okkin\/owner\/unlock/);
  assert.match(src('client', 'features', 'okkin-loft', 'index.ts'), /unlockOwner\(passphrase\)/);
  assert.match(src('client', 'features', 'kavi-board', 'send-panel.ts'), /unlockOwnerControl\(\(\) => void load\(\)\)/);
  const ui = src('client', 'features', 'hq', 'ui.ts');
  assert.match(ui, /unlockSlot\.append\(unlockOwnerControl/);
  assert.match(ui, /data\?\.private === true && opts\.onUnlock \? \[unlockOwnerControl/);
  assert.match(src('client', 'features', 'hq', 'index.ts'), /onUnlock: \(\) => void reload\(\)/);
  // The passphrase is never kept in the page.
  assert.ok(!/localStorage|sessionStorage/.test(shared));
});

test('locked talk input is greyed and disabled', () => {
  const ui = src('client', 'features', 'hq', 'ui.ts');
  assert.match(ui, /input\.disabled = true;\s*sendBtn\.disabled = true;/);
  assert.match(ui, /form\.dataset\.locked = 'yes'/);
  assert.match(src('client', 'features', 'hq', 'ui.css'), /\.hq-talk\[data-locked='yes'\] footer input,[\s\S]*?cursor: not-allowed/);
});

test('owner cookie path reaches /api/kavi/thread as well as /api/bridge (browser path matching)', async () => {
  const { ownerCookieHeader, clearOwnerCookieHeader } = await import('../src/server/hq/okkin-owner.js');
  const set = ownerCookieHeader('tok', false);
  const cookiePath = /Path=([^;]+)/.exec(set)?.[1] ?? '';
  const sends = (p: string) => p === cookiePath || p.startsWith(cookiePath.endsWith('/') ? cookiePath : cookiePath + '/');
  for (const p of ['/api/kavi/thread', '/api/bridge/talk', '/api/bridge/kavi-outbox', '/api/bridge/okkin/owner/unlock']) assert.ok(sends(p), `owner cookie must be sent to ${p}`);
  assert.ok(!sends('/'), 'not the whole site');
  assert.match(set, /HttpOnly; SameSite=Strict/);
  assert.equal(/Path=([^;]+)/.exec(clearOwnerCookieHeader(false))?.[1], cookiePath);
});

test('owner-only actions (Kavi send, unblock Yes/No): lock rule works with or without the server PR', async () => {
  const { ownerFrom, ownerLocked, KAVI_SEND_LOCKED_NOTE, UNBLOCK_LOCKED_NOTE } = await import('../src/shared/privacy-view.js');
  // Unknown is usable: without the server PR the POST still succeeds and nothing locks.
  assert.equal(ownerLocked(null), false);
  assert.equal(ownerFrom(null, { status: 200 }), null);
  // An owner read says private:true → not owner → locked; private:false → owner.
  assert.equal(ownerFrom(null, { private: true }), false);
  assert.equal(ownerFrom(false, { private: false }), true);
  // With the server PR, a 403 on the POST locks, whatever we thought before.
  assert.equal(ownerFrom(true, { status: 403 }), false);
  assert.equal(ownerLocked(false), true);
  assert.equal(KAVI_SEND_LOCKED_NOTE, 'Unlock owner to send');
  assert.equal(UNBLOCK_LOCKED_NOTE, 'Unlock owner to answer');
  const panel = src('client', 'features', 'kavi-board', 'send-panel.ts');
  assert.match(panel, /text\.disabled = locked;\s*sendBtn\.disabled = locked;\s*attach\.disabled = locked;/);
  assert.match(panel, /r\.status === 403\) \{\s*noteOwner\(\{ status: 403 \}\);\s*setStatus\(KAVI_SEND_LOCKED_NOTE, 'priv'\)/);
  assert.match(panel, /\.kavi-compose\[data-locked=yes\] textarea/);
  const stripUi = src('client', 'features', 'hq-brief', 'ui.ts');
  assert.match(stripUi, /disabled: this\.locked \|\| undefined/);
  assert.match(stripUi, /unlockOwnerControl\(\(\) => this\.hooks\.unlocked\?\.\(\)\)/);
  const brief = src('client', 'features', 'hq-brief', 'index.ts');
  assert.match(brief, /res\.status === 403\) \{[\s\S]*?noteOwner\(\{ status: 403 \}\);\s*toast\(UNBLOCK_LOCKED_NOTE/);
  assert.match(src('client', 'features', 'hq-brief', 'ui.css'), /\.unblock-strip button:disabled \{[^}]*cursor: not-allowed/);
  // A successful unlock marks the browser as owner everywhere.
  assert.match(src('client', 'ui', 'owner-unlock.ts'), /if \(r\.status === 200\) setOwner\(true\)/);
});

test('withoutOfficeCookies strips the owner cookie with the office session cookies (relay never forwards it)', async () => {
  const { withoutOfficeCookies } = await import('../src/server/auth.js');
  const { OWNER_COOKIE } = await import('../src/server/hq/okkin-owner.js');
  assert.equal(OWNER_COOKIE, 'ao_okkin_owner');
  const out = withoutOfficeCookies(`theirs=1; ao_session=s; ao_session_4600=p; ${OWNER_COOKIE}=owner-token; other=2`);
  assert.equal(out, 'theirs=1; other=2');
  assert.ok(!String(out).includes('owner-token'));
  assert.equal(withoutOfficeCookies(`${OWNER_COOKIE}=owner-token`), undefined);
  assert.equal(withoutOfficeCookies(` ${OWNER_COOKIE}=x;ao_session=y`), undefined);
  // The relay uses this one definition.
  assert.match(src('server', 'relay.ts'), /withoutOfficeCookies\(req\.headers\.cookie\)/);
});

test('Lock and Unlock also clear the old Path=/api/bridge owner cookie (Secure when secure)', async () => {
  const { clearLegacyOwnerCookieHeader } = await import('../src/server/hq/okkin-owner.js');
  assert.equal(clearLegacyOwnerCookieHeader(false), 'ao_okkin_owner=; Path=/api/bridge; HttpOnly; SameSite=Strict; Max-Age=0');
  assert.equal(clearLegacyOwnerCookieHeader(true), 'ao_okkin_owner=; Path=/api/bridge; HttpOnly; SameSite=Strict; Max-Age=0; Secure');
  const { hqRoutes } = await import('../src/server/http/routes/hq.js');
  const { testOwner, TEST_PASSPHRASE } = await import('./support/okkin-owner.js');
  const { Readable } = await import('node:stream');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  await testOwner();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-legacy-cookie-'));
  const ctx = { cfg: { dataDir, port: 4600 }, auth: { fromRequest: () => ({}), fromAnyCookie: () => true, sessionFromAnyCookie: () => ({}) } } as never;
  const call = async (route: { handle: Function }, body: unknown) => {
    const raw = JSON.stringify(body);
    const req = Readable.from([Buffer.from(raw)]) as never as import('node:http').IncomingMessage;
    req.method = 'POST';
    req.headers = { host: '127.0.0.1:4600', 'content-type': 'application/json', cookie: 'ao_session_4600=s' };
    (req as { socket?: unknown }).socket = { remoteAddress: '127.0.0.1' };
    let status = 0;
    let headers: Record<string, unknown> = {};
    const res = { writeHead(s: number, h: Record<string, unknown>) { status = s; headers = h ?? {}; }, end() {} } as never;
    await route.handle(ctx, { req, res });
    return { status, cookies: ([] as string[]).concat((headers['set-cookie'] as string[] | string | undefined) ?? []) };
  };
  const up = await call(hqRoutes.okkinOwnerUnlock, { passphrase: TEST_PASSPHRASE });
  assert.equal(up.status, 200);
  assert.ok(up.cookies.some((c) => /^ao_okkin_owner=[^;]+; Path=\/api;/.test(c)), 'new owner cookie at /api');
  assert.ok(up.cookies.includes(clearLegacyOwnerCookieHeader(false)), 'unlock clears the old-path cookie');
  const lock = await call(hqRoutes.okkinOwnerLock, {});
  assert.equal(lock.status, 200);
  assert.ok(lock.cookies.some((c) => /^ao_okkin_owner=; Path=\/api;.*Max-Age=0/.test(c)));
  assert.ok(lock.cookies.includes(clearLegacyOwnerCookieHeader(false)), 'lock clears the old-path cookie');
});
