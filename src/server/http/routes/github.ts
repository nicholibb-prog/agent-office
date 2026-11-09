// The issue and pull request windows: a PR or issue in full, its diff, and the repo's labels.
import { ghBoardBlock } from '../../../shared/protocol.js';
import { classifyGhError } from '../../github-boards.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const githubRoutes = {
  github: {
    method: 'GET',
    prefix: '/api/gh/',
    auth: 'session',
    async handle(ctx, { res, url, path: p, session }) {
      const floor = floorParam(ctx, url);
      // What the issue and PR windows show beyond the board cards (see github.ts).
      const n = Number(url.searchParams.get('number'));
      // The repo's labels (for the label picker) are the one thing not about a single issue or PR.
      if (p !== '/api/gh/labels' && (!Number.isSafeInteger(n) || n <= 0)) return send(res, 400, { error: 'Bad number' });
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const github = floor.github;
      const blocked = await github.sessionError();
      if (blocked) return send(res, 503, { error: blocked, items: [] });
      try {
        // "You" on comments is your own GitHub login once you've signed in to it.
        const me = session.account ? ctx.signins.githubLogin(session.account.id) : undefined;
        if (p === '/api/gh/pull') return send(res, 200, await github.pullDetail(n, me));
        if (p === '/api/gh/issue') return send(res, 200, await github.issueDetail(n, me));
        if (p === '/api/gh/labels') return send(res, 200, await github.repoLabels());
        if (p === '/api/gh/pull/diff') {
          const diff = await github.pullDiff(n);
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          res.end(diff);
          return;
        }
      } catch (err) {
        const message = classifyGhError(err);
        if (ghBoardBlock(message)) return send(res, 503, { error: message, items: [] });
        return send(res, 502, { error: message });
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
