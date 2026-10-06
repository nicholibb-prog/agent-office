# Local HQ

Back to the [README](../README.md).

The office can seat ten crew bots on a floor: nine generic seats (`seat-1` … `seat-9`) and one local persona, **Okkin**. Real names, Drive folder ids, tokens, and machine paths stay in gitignored files. Nothing here starts an agent CLI.

## Seats

Put `.agent-office/hq-local.json` next to that floor's `workers.json` (the same folder the office already uses for the floor). It is gitignored.

```json
{
  "crewDesks": true,
  "seats": {
    "seat-1": "desk-1",
    "seat-2": "desk-2",
    "okkin": "desk-10"
  },
  "ollamaUrl": "http://127.0.0.1:11434",
  "okkinModel": "<tag from your allowlist>",
  "okkinAllow": ["<tag>", "<smaller tag>"]
}
```

`crewDesks: true` with an empty `seats` map binds `seat-1` … `seat-6` to `desk-1` … `desk-6`. Okkin gets a desk only when `seats.okkin` names one. A shell already on a mapped desk is retired. An agent on that desk is left where it is. Crew seats are not hired from the client and never launch a process.

Restart the office after changing this file.

## Honest presence

A bridge push records a seat and the time it was seen. **Working** lasts 15 minutes from that time. A new push refreshes it. The file is re-read on a timer and does not stamp "now" onto an old heartbeat, so the lease can expire.

| Age of the last heartbeat | Chip |
| --- | --- |
| Blocked / needs input, any age | blocked |
| Working, under 15 minutes | working |
| Working, 15–30 minutes | idle (may wander) |
| Working, 30–45 minutes | stale (stays seated) |
| 45 minutes, or never seen | offline |

`needs_input` on a worker is never overwritten. Chat does not force **working**. Okkin is not painted by the bridge: that seat follows a probe of local Ollama.

`POST /api/bridge/status` and `POST /api/bridge/crew-status` and `POST /api/bridge/hq-status` all sit behind the bridge gate (loopback Host, and a bridge token or an office session). The body names a seat id such as `seat-3`, not a person.

## Talk and the desk card

Press **Y**. Near a crew desk (about 2.5 m) that opens a thread with that seat. Otherwise it opens the roster: ten rows, each with a chip, an age, a one-line task, and **Go**, **Talk**, and **Desk**. **Desk** is a card (condition, actions, needs, task, milestone, link). **✕** or **Esc** closes it and returns you to mouse-look.

Player lines are written to `.agent-office/chat-outbox.jsonl`. The file keeps the last 200 lines and is replaced as a whole (mode `0600`). A separate process can sync that file. This repo does not know folder ids or API tokens. Inbox lines dropped in `chat-inbox.jsonl` are ingested for the nine generic seats only, and only when they are `{ "v": 1, "role": "bot", "seat": "seat-N", "text": "...", "at": "<ISO-8601>" }`. Okkin is never spoken from the inbox or from `POST /api/bridge/say`.

```json
{ "v": 1, "kind": "talk", "seat": "seat-1", "thread": "seat-1", "role": "player", "text": "hello", "at": "2026-01-01T00:00:00.000Z" }
```

`kind` is `talk` or `tchat`. `role` is `player`, `bot`, or `office`. Threads live in `talk-threads.json` (the last 80 lines). Cards live in `desk-cards.json`. Files are mode `0600`.

There is no canned reply in a crew member's name.

## Okkin

Okkin is one seat (`crew-okkin`). Talk goes to Ollama on the office machine.

- `OLLAMA_URL` (env, else `ollamaUrl` in `hq-local.json`). Unset means `http://127.0.0.1:11434`. Only `http`. `https` is refused. `localhost` is rewritten to the literal `127.0.0.1` (the office does not ask the OS resolver). `::1` stays the literal `[::1]`. Any other host is refused and Okkin stays offline. Redirects are not followed. A response over about 1 MB is dropped. A URL in a request is ignored.
- `OKKIN_MODEL` (env, else `okkinModel`). Not hardcoded.
- `OKKIN_MODEL_ALLOW` (comma-separated env, else `okkinAllow`). The switch lists the intersection of that allowlist and `GET /api/tags`.

The desk shows the loaded model name and a state word from `GET /api/ps`: `loaded`, `unloaded`, or `unknown`. The browser is not sent the Ollama body (no digest, size, expiry, or VRAM).

`POST /api/bridge/okkin/model` with `{ "model": "<exact tag>" }` is behind the same gate. The tag must be in the allowlist ∩ installed tags, or the office returns 400. Switching unloads the previous model with `POST /api/generate` and `keep_alive: 0`, then warms the next one. The chip is `switching`, never working. Working is only while a real `POST /api/chat` is in flight. A second talk or switch while one is in flight is rejected (409). Unreachable Ollama, including a machine that is asleep, is offline.

Allowed calls are `GET /api/tags`, `GET /api/ps`, `POST /api/chat`, and `POST /api/generate`. There is no pull, delete, create, copy, push, or raw proxy. Every caller uses `src/server/ollama.ts`. A later change that also talks to Ollama imports that module.

Prompts and replies are not written outside `.agent-office/`.

## Idle

When a seat's chip is idle, the desk card is quiet, and you are not in its talk window, the bot may walk the aisle. If a meeting is already running it may stand by the table. If the floor has a hoop or the arcade cabinet, it may stand there. That movement does not change the chip and does not start a meeting. Working, blocked, switching, stale, and offline stay seated.

## Not in this change

A morning delta and a needsOwner strip are not here. They belong in a later change.

After you edit `hq-local.json`, restart the office. A sync process of your own has to move `chat-outbox.jsonl` and `chat-inbox.jsonl`. Ollama has to be listening on loopback, with `OKKIN_MODEL` and `OKKIN_MODEL_ALLOW` set to tags you have already pulled.
