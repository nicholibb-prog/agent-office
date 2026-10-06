# ForgeL bind

The office UI and its WebSocket listen on **127.0.0.1** unless you pass `--host`. The default is never `0.0.0.0`. `HOST` in the environment is ignored.

| Process | Address | Port |
| --- | --- | --- |
| Office (HTTP and WebSocket) | 127.0.0.1 | 4600 |
| Vite, while developing (`npm run dev`) | 127.0.0.1 | 5173 |

Vite proxies `/api` and `/ws` to `127.0.0.1:4600`. Open http://127.0.0.1:4600, or http://127.0.0.1:5173 during development (password `dev`).

```bash
npm run dev
# or, from a build:
agent-office --host 127.0.0.1 --port 4600 --no-open
```
