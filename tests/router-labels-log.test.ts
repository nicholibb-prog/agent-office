// Data labels (#3, #28) and the routing log (#18): label from the allow-list only, default private;
// the log keeps whitelisted fields and hash-only scan hits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classify, isStudentSource, loadDataClasses, parseDataClasses } from '../src/server/router/data-classes.js';
import { cleanEntry, mtDate, routingLogger, ROUTING_LOG_DIR } from '../src/server/router/routing-log.js';

const classes = loadDataClasses();

test('labels come from config/data-classes.json only; unlisted or missing is private', () => {
  assert.equal(classify({ repo: 'nicholibb-prog/agent-office' }, classes), 'public');
  assert.equal(classify({ repo: 'NICHOLIBB-PROG/agent-office' }, classes), 'public');
  assert.equal(classify({}, classes), 'private');
  assert.equal(classify({ repo: 'someone/unknown' }, classes), 'private');
  assert.equal(classify({ repo: 'nicholibb-prog/agent-office', source: 'email' }, classes), 'private', 'any private source makes it private');
  assert.equal(classify({ repo: 'nicholibb-prog/agent-office', source: 'env' }, classes), 'secret');
  assert.equal(classify({ source: 'preply' }, classes), 'private');
  assert.equal(isStudentSource({ source: 'preply' }, classes), true);
  // The task's own label field is never trusted.
  assert.equal(classify({ repo: 'someone/unknown', label: 'public' } as never, classes), 'private');
});

test('an unreadable or malformed data-classes file fails closed (nothing public)', () => {
  const none = loadDataClasses('/nonexistent/data-classes.json');
  assert.equal(classify({ repo: 'nicholibb-prog/agent-office' }, none), 'private');
  assert.throws(() => parseDataClasses('{"public": "everything"}'));
});

test('routing log: JSONL per MT day, 0600, whitelisted fields, hash-only hits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-rlog-'));
  try {
    const at = Date.parse('2026-10-14T05:30:00Z'); // 11:30 PM MT on the 13th
    const log = routingLogger(dir, () => at);
    log({ task_id: 't1', level: 2, label: 'public', provider: 'groq', result: 'blocked', prompt: 'SECRET PROMPT', scan_hits: [{ type: 'EMAIL', sha8: 'deadbeef', offset_bucket: 0, match: 'jane@corp.io' }] } as never);
    const files = readdirSync(path.join(dir, ROUTING_LOG_DIR));
    assert.deepEqual(files, ['2026-10-13.jsonl']);
    const file = path.join(dir, ROUTING_LOG_DIR, files[0]);
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('SECRET PROMPT') && !text.includes('jane@corp.io'));
    const e = JSON.parse(text);
    assert.deepEqual(Object.keys(e), ['ts', 'task_id', 'level', 'label', 'source', 'tier', 'provider', 'model', 'attempt', 'tokens_in', 'tokens_out', 'cost_usd', 'result', 'escalated_to', 'scan_hits', 'latency_ms']);
    assert.deepEqual(e.scan_hits, [{ type: 'EMAIL', sha8: 'deadbeef', offset_bucket: 0 }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(mtDate(Date.parse('2026-10-14T07:00:00Z')), '2026-10-14');
  assert.deepEqual(cleanEntry({ scan_hits: [{ type: 'EMAIL', sha8: 'NOT-HEX!', offset_bucket: 0 }] as never }).scan_hits, []);
});
