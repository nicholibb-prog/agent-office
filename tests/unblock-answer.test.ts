// Yes/No is a signed-in person. A bridge token never types into a desk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestHandler } from '../src/server/http/router.js';
import { hqBriefRoutes } from '../src/server/http/routes/hq-brief.js';
import { saveBlocks } from '../src/server/hq/brief.js';
import { titleHash } from '../src/shared/hq-brief.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

type Write = { id: string; data: string; by: string };

function worker(over: Partial<WorkerInfo> & { id: string }): WorkerInfo {
  return {
    deskId: 'desk-1',
    name: 'desk-1',
    status: 'needs_input',
    activity: 'Approve npm test',
    waitingSince: 1000,
    createdAt: 1,
    ...over,
  } as WorkerInfo;
}

function office(workers: WorkerInfo[], opts?: { boom?: Error }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-ans-'));
  const writes: Write[] = [];
  const ctx = {
    cfg: { dataDir: dir, port: 4600 },
    auth: {
      fromRequest(req: { headers: { cookie?: string | string[] } }) {
        const c = String(req.headers.cookie || '');
        if (c.includes('ao_session=human')) return { account: { id: 'acct-1' } };
        return undefined;
      },
      fromAnyCookie: () => false,
    },
    floors: new Map([
      [
        'home',
        {
          workers: {
            list: () => workers,
            write: (id: string, data: string, by: string) => {
              if (opts?.boom) throw opts.boom;
              writes.push({ id, data, by });
            },
          },
          queue: { state: () => ({ tasks: [] }) },
        },
      ],
    ]),
  };
  const server = createServer(requestHandler(ctx as never, [hqBriefRoutes.answer]));
  return { dir, writes, server };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
}

function post(server: Server, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string; json: { error?: string; ok?: boolean } }> {
  const port = (server.address() as { port: number }).port;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/bridge/unblock/answer',
        method: 'POST',
        headers: {
          ...headers,
          host: '127.0.0.1:4600',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, text, json: text ? (JSON.parse(text) as { error?: string; ok?: boolean }) : {} });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const HUMAN = { cookie: 'ao_session=human' };
const TOKEN = 'a'.repeat(64);

function yes(id: string, patch: Record<string, unknown> = {}) {
  return { id, answer: 'yes', at: 1000, titleHash: titleHash('Approve npm test'), workerId: 'w-other', ...patch };
}

test('a bridge token or bearer cannot answer', async () => {
  const { dir, writes, server } = office([worker({ id: 'w1' })]);
  await listen(server);
  try {
    const token = await post(server, { 'x-bridge-token': TOKEN }, yes('live:w1'));
    const bearer = await post(server, { authorization: `Bearer ${TOKEN}` }, yes('live:w1'));
    const both = await post(server, { ...HUMAN, 'x-bridge-token': TOKEN }, yes('live:w1'));
    const bearerSession = await post(server, { ...HUMAN, authorization: `Bearer ${TOKEN}` }, yes('live:w1'));
    assert.ok(token.status === 401 || token.status === 403, String(token.status));
    assert.ok(bearer.status === 401 || bearer.status === 403, String(bearer.status));
    assert.equal(both.status, 403);
    assert.equal(bearerSession.status, 403);
    assert.deepEqual(writes, []);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a worker that is not waiting is not typed into', async () => {
  const { dir, writes, server } = office([worker({ id: 'w1', status: 'working' })]);
  await listen(server);
  try {
    const res = await post(server, HUMAN, yes('live:w1'));
    assert.equal(res.status, 409);
    assert.deepEqual(writes, []);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('body workerId is ignored and the filed desk is typed', async () => {
  const { dir, writes, server } = office([
    worker({ id: 'w1' }),
    worker({ id: 'w2', deskId: 'desk-2', activity: 'Approve the other one', waitingSince: 1000 }),
  ]);
  saveBlocks(dir, [
    { id: 'b1', seat: 'seat-a', title: 'Approve npm test', kind: 'yesno', actionable: true, at: 1000, workerId: 'w1' },
  ]);
  await listen(server);
  try {
    const res = await post(server, HUMAN, yes('b1', { workerId: 'w2' }));
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(writes, [{ id: 'w1', data: '1', by: 'acct-1' }]);
    const disk = JSON.parse(readFileSync(path.join(dir, 'unblock.json'), 'utf8')) as { answered: { by: string; answer: string }[] };
    assert.equal(disk.answered[0].by, 'acct-1');
    assert.equal(disk.answered[0].answer, 'yes');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a talk block never types', async () => {
  const { dir, writes, server } = office([worker({ id: 'w1' })]);
  saveBlocks(dir, [
    { id: 't1', seat: 'seat-a', title: 'Need a look', kind: 'talk', actionable: true, at: 1000, workerId: 'w1' },
  ]);
  await listen(server);
  try {
    const res = await post(server, HUMAN, yes('t1'));
    assert.equal(res.status, 409);
    assert.deepEqual(writes, []);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a stale at or title hash does not type', async () => {
  const { dir, writes, server } = office([worker({ id: 'w1' })]);
  await listen(server);
  try {
    const old = await post(server, HUMAN, yes('live:w1', { at: 999 }));
    const renamed = await post(server, HUMAN, yes('live:w1', { titleHash: 'deadbeef' }));
    assert.equal(old.status, 409);
    assert.equal(renamed.status, 409);
    assert.deepEqual(writes, []);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a 500 from answering does not include the exception text', async () => {
  const { dir, writes, server } = office([worker({ id: 'w1' })], { boom: new Error('ENOENT /tmp/secret/office') });
  await listen(server);
  try {
    const res = await post(server, HUMAN, yes('live:w1', { workerId: 'w1' }));
    assert.equal(res.status, 500);
    assert.equal(res.json.error, 'internal error');
    assert.equal(res.text.includes('secret'), false);
    assert.equal(res.text.includes('ENOENT'), false);
    assert.deepEqual(writes, []);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
