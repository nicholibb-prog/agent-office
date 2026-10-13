// Owner -> Kavi sends. Office session only: a bridge, shared or seat token is refused outright.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { send } from '../util.js';
import { hostOk, originOk } from './bridge.js';
import { BodyTooLarge, closeTooLarge, readJsonBody } from '../read-body.js';
import { KaviSendError, MAX_FILE_BYTES, readBack, sendFile, sendMessage } from '../../kavi-send.js';
import type { Route } from '../router.js';

const bridgeDir = () => process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR || undefined;

/** Loopback Host, same-origin, and no bridge/seat token at all: sends are the owner's own session. */
export function kaviSessionGate(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!hostOk(req)) return send(res, 403, { error: 'host not allowed' }), false;
  if (!originOk(req)) return send(res, 403, { error: 'origin not allowed' }), false;
  if (req.headers['x-bridge-token'] || req.headers.authorization) {
    return send(res, 403, { error: 'only an office session can send to Kavi' }), false;
  }
  return true;
}

function fail(res: http.ServerResponse, err: unknown) {
  if (err instanceof KaviSendError) return send(res, err.status, { error: err.message });
  return send(res, 500, { error: 'The office could not complete that' });
}

function readRaw(req: http.IncomingMessage, cap: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > cap) return Promise.reject(new BodyTooLarge());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      total += c.length;
      if (total > cap) {
        done = true;
        req.pause();
        return reject(new BodyTooLarge());
      }
      chunks.push(c);
    });
    req.on('end', () => !done && resolve(Buffer.concat(chunks)));
    req.on('error', (e) => !done && reject(e));
  });
}

export const kaviSendRoutes = {
  bridge: {
    method: 'GET' as const,
    path: '/api/kavi/bridge',
    auth: 'session' as const,
    handle(_ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!kaviSessionGate(req, res)) return;
      return send(res, 200, readBack(bridgeDir()));
    },
  },
  message: {
    method: 'POST' as const,
    path: '/api/kavi/message',
    auth: 'session' as const,
    async handle(_ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!kaviSessionGate(req, res)) return;
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return send(res, 415, { error: 'Content-Type must be application/json' });
      }
      let text = '';
      try {
        text = String((JSON.parse(await readJsonBody(req)) as { text?: unknown })?.text ?? '');
      } catch (err) {
        if (err instanceof BodyTooLarge) return closeTooLarge(req, res);
        return send(res, 400, { error: 'bad json' });
      }
      try {
        return send(res, 200, sendMessage(bridgeDir(), text));
      } catch (err) {
        return fail(res, err);
      }
    },
  },
  file: {
    method: 'POST' as const,
    path: '/api/kavi/file',
    auth: 'session' as const,
    async handle(_ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!kaviSessionGate(req, res)) return;
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/octet-stream')) {
        return send(res, 415, { error: 'Content-Type must be application/octet-stream' });
      }
      let name = '';
      try {
        name = decodeURIComponent(String(req.headers['x-file-name'] || ''));
      } catch {
        return send(res, 400, { error: 'bad file name' });
      }
      let data: Buffer;
      try {
        data = await readRaw(req, MAX_FILE_BYTES);
      } catch (err) {
        if (err instanceof BodyTooLarge) return closeTooLarge(req, res);
        return send(res, 400, { error: 'bad upload' });
      }
      try {
        return send(res, 200, sendFile(bridgeDir(), name, data));
      } catch (err) {
        return fail(res, err);
      }
    },
  },
} satisfies Record<string, Route>;
