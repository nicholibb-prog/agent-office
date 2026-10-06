// JSON bodies on the bridge stay small. A larger one is refused before it is parsed.
import type http from 'node:http';

export const MAX_JSON_BODY = 16 * 1024;

export class BodyTooLarge extends Error {
  readonly status = 413;
}

export function readJsonBody(req: http.IncomingMessage): Promise<string> {
  const declared = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY) return Promise.reject(new BodyTooLarge());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooBig = false;
    req.on('data', (c: Buffer | string) => {
      if (tooBig) return;
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += buf.length;
      if (total > MAX_JSON_BODY) {
        tooBig = true;
        req.pause();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (!tooBig) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!tooBig) reject(err);
    });
  });
}

/** 413 after the response is queued, then drop the socket. Destroying first is an ECONNRESET. */
export function closeTooLarge(req: http.IncomingMessage, res: http.ServerResponse): void {
  const body = JSON.stringify({ error: 'body too large' });
  if (!res.headersSent) {
    res.writeHead(413, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'close',
      'content-length': String(Buffer.byteLength(body)),
    });
  }
  res.end(body, () => {
    req.destroy();
  });
}
