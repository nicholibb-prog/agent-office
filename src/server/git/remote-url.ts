// A checkout's origin, read and shown without credentials. `git remote get-url` applies
// url.*.insteadOf, so the URL git reports can carry userinfo (a token) that was never stored on
// the remote. That string is the floor's project.remote, and every signed-in browser is sent it.
// Read the configured URL instead, and still strip userinfo before anything is kept, logged or sent.
import { execFileSync } from 'node:child_process';
import { normalizeRepo } from '../../shared/floors.js';

/** The origin URL as it was configured. insteadOf rewrites are not applied. */
export function readOriginUrl(dir: string, timeout = 10_000): string | undefined {
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
    }).trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

/**
 * owner/repo when origin is on GitHub. A URL that was saved with userinfo still matches: the
 * credential is not part of the repository name.
 */
export function originRepo(dir: string, timeout = 10_000): string | undefined {
  const url = readOriginUrl(dir, timeout);
  return url ? normalizeRepo(url) : undefined;
}

/**
 * What a client may be shown for a remote: `owner/repo` on GitHub, otherwise host and path.
 * An http(s) URL is parsed and its username and password cleared. An scp-style `git@host:path`
 * keeps the host and the path. Anything left that still carries userinfo is dropped.
 */
export function sanitizeRemoteUrl(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      u.username = '';
      u.password = '';
      u.search = '';
      u.hash = '';
      const host = u.hostname;
      const pathName = u.pathname.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
      if (/^github\.com$/i.test(host)) return normalizeRepo(`https://github.com/${pathName}`);
      if (u.protocol === 'file:') return u.pathname.replace(/\.git$/i, '') || undefined;
      if (!host) return pathName || undefined;
      return pathName ? `${host}/${pathName}` : host;
    } catch {
      return undefined;
    }
  }
  const scp = /^(?:[^@\s/]+@)?([^:\s/]+):(.+)$/.exec(s);
  if (scp) {
    const host = scp[1];
    const pathName = scp[2].replace(/[?#].*$/, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    if (/^github\.com$/i.test(host)) return normalizeRepo(`git@github.com:${pathName}`);
    return pathName ? `${host}/${pathName}` : host;
  }
  return normalizeRepo(s);
}

/**
 * Takes user:password out of URLs in text that is about to be logged or sent. The rest of the
 * string stays, so an error can still say which host it was.
 */
export function redactUserinfo(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)(?:[^/\s@]+)(?::[^/\s@]*)?@/gi, '$1')
    .replace(/(^|[\s'"(])[^/\s@]+:[^/\s@]+@(?=[^\s:/]+:)/g, '$1');
}
