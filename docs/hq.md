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
  "okkinModel": "<tag from your allowlist>",
  "okkinAllow": ["<tag>", "<smaller tag>"],
  "names": { "seat-1": "<local name>" }
}
```

`seats` maps a seat id to a desk id. `names` is optional and gitignored with the rest of the file: it maps a seat id to a display name on this machine. With `names` omitted, the roster and the talk window say `seat-1` … `seat-9`. Okkin stays Okkin. A path or an address is ignored. The Ollama address is `OLLAMA_URL` or gitignored `.agent-office/ollama.json`, not this file.

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

A blocked bridge push sets `needs_input` (`lastInput.by` is `crew-status`). A later bridge push for that seat clears it. A `needs_input` from any other source stays until that source clears it. The working lease does not clear `needs_input`. Chat does not force **working**. Okkin is not painted by the bridge: that seat follows a probe of local Ollama.

`POST /api/bridge/status` and `POST /api/bridge/crew-status` and `POST /api/bridge/hq-status` all sit behind the bridge gate (loopback Host, and a bridge token or an office session). The body names a seat id such as `seat-3`, not a person.

## Talk and the desk card

Press **Y**. Near a crew desk (about 2.5 m) that opens a thread with that seat. Otherwise it opens the roster: ten rows, each with a chip, an age, a one-line task, and **Go**, **Talk**, and **Desk**. **Desk** is a card (condition, actions, needs, task, milestone, link). **✕** or **Esc** closes it and returns you to mouse-look.

`POST /api/bridge/talk` takes an office session. A bridge token or a Bearer header is refused (403), even if a session cookie is sent with it. An admin, or the shared office password, writes `role` `player`. Any other account writes `guest`. The outbox records `by` as that account id when there is one. Talk is limited to one line every 3 seconds and 20 lines a minute per account (429). Request bodies over 16 KB are refused (413).

Player and guest lines are written to `.agent-office/chat-outbox.jsonl`. The file keeps the last 200 lines and is replaced as a whole (mode `0600`). A separate process can sync that file. This repo does not know folder ids or API tokens.

A bot line in a generic seat's thread is only an inbox record posted through `POST /api/bridge/inbox` (the bridge gate: loopback Host, and a bridge token or an office session). The body is `{ "seat": "seat-1", "text": "..." }`. Okkin is refused there. The office copies that text into the thread. It does not write a bot line of its own. `POST /api/bridge/say` folds the name (compatibility form, format and mark characters stripped, non-letters dropped, case folded) and refuses any name that then contains `okkin`.

Talking to an offline seat with no bot line queues the text and adds one office line: `offline — message queued for seat-1` (or the local display name). The chip stays offline.

```json
{ "v": 1, "kind": "talk", "seat": "seat-1", "thread": "seat-1", "role": "player", "text": "hello", "at": "2026-01-01T00:00:00.000Z" }
```

`kind` is `talk` or `tchat`. `role` is `player`, `guest`, `bot`, or `office`. `by` is the account id when the line came from an account. Threads live in `talk-threads.json` (the last 80 lines). Cards live in `desk-cards.json`. Files are mode `0600`.

There is no canned reply in a crew member's name.

## Okkin

Okkin is one seat (`crew-okkin`). Talk goes to Ollama on the office machine.

- `OLLAMA_URL`, else `url` in gitignored `.agent-office/ollama.json`, else `http://127.0.0.1:11434`. Only `http`. `https` is refused. `localhost` is rewritten to the literal `127.0.0.1` (the office does not ask the OS resolver). `::1` stays the literal `[::1]`. Any other host is refused and Okkin stays offline (the office does not fall back to the default). Redirects are not followed. A response over about 1 MB is dropped, including when `Content-Length` says so before the body is read. A URL in a request is ignored. `hq-local.json` does not set this address.
- `OKKIN_MODEL` (env, else `okkinModel`). Not hardcoded.
- `OKKIN_MODEL_ALLOW` (comma-separated env, else `okkinAllow`). The switch lists the intersection of that allowlist and `GET /api/tags`.

The desk shows the loaded model name and a state word from `GET /api/ps`: `loaded`, `unloaded`, or `unknown`. The browser is not sent the Ollama body (no digest, size, expiry, or VRAM).

`POST /api/bridge/okkin/model` with `{ "model": "<exact tag>" }` needs an office session (a bridge token is 403). A second switch within 45 seconds is 429. The tag must be in the allowlist ∩ installed tags, or the office returns 400 and does not start that wait. Switching unloads the previous model with `POST /api/generate` and `keep_alive: 0`, then warms the next one with `num_predict` 1 and no prompt. Chat sends `num_predict` 256. The model name stays in the JSON body; it never changes the URL path. The chip is `switching`, never working. Working is only while a real `POST /api/chat` is in flight. A second talk or switch while one is in flight is rejected (409). Unreachable Ollama, including a machine that is asleep, is offline.

Allowed calls are `GET /api/tags`, `GET /api/ps`, `POST /api/chat`, and `POST /api/generate`. There is no pull, delete, create, copy, push, or raw proxy. Every caller uses `src/server/ollama.ts`. A later change that also talks to Ollama imports that module.

Prompts and replies are not written outside `.agent-office/`.

## Idle

When a seat's chip is idle, the desk card is quiet, and you are not in its talk window, the bot may walk the aisle. If a meeting is already running it may stand by the table. If the floor has a hoop or the arcade cabinet, it may stand there. That movement does not change the chip and does not start a meeting. Working, blocked, switching, stale, and offline stay seated.

## Not in this change

A morning delta and a needsOwner strip are not here. They belong in a later change.

After you edit `hq-local.json`, restart the office. A sync process of your own has to move `chat-outbox.jsonl` and `chat-inbox.jsonl`. Ollama has to be listening on loopback, with `OKKIN_MODEL` and `OKKIN_MODEL_ALLOW` set to tags you have already pulled.
