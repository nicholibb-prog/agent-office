# Loopback bind

The office is for the computer it runs on. HTTP, the WebSocket, and the dev server listen on **127.0.0.1** unless you explicitly pass something else. This fork does not add a deploy script that opens the office on a LAN or the public internet.

## Defaults

| Process | Address | Where it is set |
| --- | --- | --- |
| Office HTTP and WebSocket | `127.0.0.1:4600` | `loadConfig` in `src/server/config.ts` (`--host` / `--port`, env `PORT` for the port only). `startServer` listens on `cfg.host`. |
| Worker hook server | `127.0.0.1` on the port saved in `.agent-office/hook-port` | `src/server/hooks/server.ts` hardcodes `127.0.0.1`. |
| Vite (`npm run dev`) | `127.0.0.1:5173` | `server.host` and `server.port` in `vite.config.ts`. `/api` and `/ws` proxy to `127.0.0.1:4600`. |

`npm run dev` starts Vite and `tsx watch src/server/cli.ts --port 4600 --password dev --no-open`. It does not pass `--host`, so the office stays on `127.0.0.1`.

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173 . The password in that dev command is `dev`.

## What is not the default

`--host 0.0.0.0` (and `--host ::`) still exist, because the upstream office uses them when someone asks. They are opt-in. Leaving them off is the configuration this tree runs with. Do not change the default to `0.0.0.0`.

## Local Jev rankings

Rankings for the standing board live in `<data>/.agent-office/jev-metrics.json` on this machine. The dev server reads them through `GET /api/jev` on the loopback office. Nothing in that path calls a hosted API.
