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

`POST /api/bridge/talk` is owner only, for every seat (crew seats and Okkin): a verified office session that has also unlocked owner. A bridge token, a seat token, a Bearer header or `x-pool-caller` is refused (403, logged to `okkin-refusals.log`), even if a session or owner cookie is sent with it. A session that has not unlocked owner, including an admin or member account, is refused (403, logged). A cookie from another port of this host counts only when it verifies. An unknown or renamed cookie is 401. When the owner is signed in with an admin account or the shared office password, the line is written as `role` `player`; with any other account, including a member, it is `guest`. The outbox and the thread record `by` as that account id when there is one. Talk is limited to one line every 3 seconds and 20 lines a minute per account (429). Request bodies over 16 KB are refused (413) and the connection is closed.

Reading seat text is scoped too. `GET /api/bridge/talk?seat=` (crew seats) and `GET /api/bridge/kavi-outbox`: a seat token reads only its own seat (another seat is 403, logged); the shared bridge token and `x-pool-caller` are refused (403, logged); the owner reads everything; any other session gets 200 with `messages: []` / `items: []` and `private: true`. Outbox items carry the `seat` that queued them; a seat-provider turn is stamped with a crew seat only through the explicit, gitignored `.agent-office/seat-map.json` (`{"<floorId>:<deskOrMeetingId>": "<crewSeatId>"}`, crew seat must be a real seat id); unmapped turns get `seat: null`. A seat token sees only items whose `seat` exactly equals its own; `null` or missing is owner-only. An `Authorization` header is refused here (403, logged); seat tokens use `x-bridge-token`. `POST /api/bridge/desk`: a seat token writes its own seat (a different `body.seat` is 403, logged); a session must be the owner; the shared token is refused. Refusal log lines hold the route and caller kind only, never a token or passphrase.

Player and guest lines are written to `.agent-office/chat-outbox.jsonl`. The file keeps the last 200 lines and is replaced as a whole (mode `0600`). A separate process can sync that file. This repo does not know folder ids or API tokens.

A bot line in a generic seat's thread is only an inbox record posted through `POST /api/bridge/inbox` with that seat's own seat token (loopback Host; the shared bridge token and an office session are refused). The seat comes from the token, not the body: the body is `{ "text": "..." }`, a `seat` in the body that is not the token's seat is 403, and no or an unknown token is 401. Okkin is refused there. The office copies that text into the thread. It does not write a bot line of its own. `POST /api/bridge/say` folds the name before that check: compatibility decomposition, format and mark characters stripped, then look-alike letters (Greek ο κ ι ν, small capitals, a dotless i, a Cyrillic palochka, Cyrillic і о к, and Latin kra ĸ) plus `0` to o and `1`, `l`, or an inverted `¡` to i. What remains is lowercased, non-letters dropped, and refused when it contains `okkin`. `0kkin` is refused.

Talking to an offline seat with no bot line queues the text and adds one office line: `offline — message queued for seat-1` (or the local display name). The chip stays offline.

```json
{ "v": 1, "kind": "talk", "seat": "seat-1", "thread": "seat-1", "role": "player", "text": "hello", "at": "2026-01-01T00:00:00.000Z" }
```

`kind` is `talk` or `tchat`. `role` is `player`, `guest`, `bot`, or `office`. `by` is the account id when the line came from an account, on the outbox line and on the thread record. Threads live in `talk-threads.json` (the last 80 lines). Cards live in `desk-cards.json`. Files are mode `0600`. `kavi-feed.json` and `kavi-outbox.json` are written the same way. The outbox keeps the last 200 items.

There is no canned reply in a crew member's name.

## Okkin

Okkin is one seat (`crew-okkin`). Talk goes to Ollama on the office machine.

- `OLLAMA_URL`, else `url` in gitignored `.agent-office/ollama.json`, else `http://127.0.0.1:11434`. Only `http`. `https` is refused. `localhost` is rewritten to the literal `127.0.0.1` (the office does not ask the OS resolver). `::1` stays the literal `[::1]`. Any other host is refused and Okkin stays offline (the office does not fall back to the default). Redirects are not followed. A response over about 1 MB is dropped, including when `Content-Length` says so before the body is read. A URL in a request is ignored. `hq-local.json` does not set this address.
- `OKKIN_MODEL` (env, else `okkinModel`). Not hardcoded.
- `OKKIN_MODEL_ALLOW` (comma-separated env, else `okkinAllow`). The switch lists the intersection of that allowlist and `GET /api/tags`.

The desk shows the loaded model name and a state word from `GET /api/ps`: `loaded`, `unloaded`, or `unknown`. The browser is not sent the Ollama body (no digest, size, expiry, or VRAM).

`POST /api/bridge/okkin/model` with `{ "model": "<exact tag>" }` needs an office session (a bridge token is 403). A second switch within 45 seconds is 429. The tag must be in the allowlist ∩ installed tags, or the office returns 400 and does not start that wait. A switch that reaches Ollama and comes back 200 or 502 does start it, so a retry of a failed unload does not unload again. Switching unloads the previous model with `POST /api/generate` and `keep_alive: 0`, then warms the next one with `num_predict` 1 and no prompt. Chat sends `num_predict` 256. The model name stays in the JSON body; it never changes the URL path. The chip is `switching`, never working. Working is only while a real `POST /api/chat` is in flight. A second talk or switch while one is in flight is rejected (409). Unreachable Ollama is offline. When the host sleeps, the whole office is closed, which is a normal state and not offline (see [Providers](providers.md#open-and-closed)).

Allowed calls are `GET /api/tags`, `GET /api/ps`, `POST /api/chat`, and `POST /api/generate`. There is no pull, delete, create, copy, push, or raw proxy. Every caller uses `src/server/ollama.ts`. A later change that also talks to Ollama imports that module.

Prompts and replies are not written outside `.agent-office/`.

## Idle

When a seat's chip is idle, the desk card is quiet, and you are not in its talk window, the bot may walk the aisle. If a meeting is already running it may stand by the table. If the floor has a hoop or the arcade cabinet, it may stand there. That movement does not change the chip and does not start a meeting. Working, blocked, switching, stale, and offline stay seated.

## Not in this change

A morning delta and a needsOwner strip are not here. They belong in a later change.

After you edit `hq-local.json`, restart the office. A sync process of your own has to move `chat-outbox.jsonl` and `chat-inbox.jsonl`. Ollama has to be listening on loopback, with `OKKIN_MODEL` and `OKKIN_MODEL_ALLOW` set to tags you have already pulled.

## Okkin's controls are owner-only

Power on/off, the model switch and Ask to Okkin are checked on the server (`src/server/hq/okkin-owner.ts`).

**Owner passphrase.** The owner proves it with a separate owner passphrase, not the office password.
Set it once, on the office machine, in a terminal: `npm run owner:set`. It asks twice, with no echo,
and takes no arguments; there is no other way to set it. Only a salted scrypt hash is stored (Node's
built-in `crypto.scrypt`), in an owner-only file outside the repo: `%APPDATA%\agent-office\okkin-owner.json`
on Windows, `~/.config/agent-office/okkin-owner.json` elsewhere (0600 in a 0700 folder), or the path in
`AGENT_OFFICE_OWNER_FILE`. Its sha256 is noted beside it in `okkin-owner.json.sha256`. The plaintext
never touches disk, argv, env or logs. Until it is set, the controls say
"Owner not set up — run npm run owner:set on the ProArt", and everyone is refused.

**Unlock owner.** In the Okkin panel, "Unlock owner" takes the passphrase and checks it in constant time.
Five wrong tries per 15 minutes (per address) lock unlocking for 15 minutes; failures are logged without
the input. Success sets a separate owner cookie (`ao_okkin_owner`: HttpOnly, SameSite=Strict, Path=/api/bridge,
Secure on https), held in server memory only: 15 minutes idle, 1 hour at most; Lock, signing out of the
office, or a restart ends it. Power on/off also needs an unlock in the last 5 minutes.

**Who may unlock.** It takes an office session (the shared office password is enough; the owner does
not need an account) PLUS the correct owner passphrase. An office-password session is never the owner
by itself: a session alone never is. The approvers list (`work-pool-policy.json`) is deliberately not
consulted: that check was dropped on purpose, so the passphrase is the one thing that makes the owner. Unlocking is rate-limited per address (5 failures per
15 minutes) and globally (20 failures per 15 minutes across all addresses), each followed by a 15-minute
lockout; the limiter prunes expired entries and holds at most 1,000 addresses. Lock (`POST
/api/bridge/okkin/owner/lock`) has the same checks as the other controls (session, Host, Origin, JSON);
bot credentials get 403. The panel's status polling does not extend the owner's idle timer.

**Where the hash may live.** `AGENT_OFFICE_OWNER_FILE` is refused (nobody is the owner, and `owner:set`
fails) if it points inside Major Files (checked on the path as given, then on its realpath) or inside the
office's own repo; nothing at a refused path is read or written.

**Nobody else.** Not the office password session, not any account, and never a request carrying a bot
credential (the bridge token or a seat token in `x-bridge-token`, an `x-pool-caller` token, or any
`Authorization` header), even with an owner cookie alongside it: 403 `owner only`. Bots must never be
given the owner passphrase (or the office password). Refusals go to `.agent-office/okkin-refusals.log`
(time, route, caller kind; never a token, cookie or input), rotated at 256 KB to `.1` (two files at most).

**Integrity, and a known gap.** The office pins the owner file's sha256 when it starts and re-checks it
every 60 seconds and on every owner request. If the file changes or disappears, it logs that, drops live
owner sessions, and refuses unlocks until it is restarted (after a deliberate `npm run owner:set`, restart
the office). This only makes a swap visible: any process running as the same OS user can overwrite files,
including this one. The real fix is to run bots under a separate Windows account.

**The office password.** The office still accepts any password, including `dev` (which local test setups
use). Use a long one from `AGENT_OFFICE_PASSWORD_FILE`. Flagged for Dan: the server does not refuse a weak
or default office password yet.

TODO: a passkey (WebAuthn) for the owner, instead of or alongside the passphrase.

A locked switch always says why in the panel, e.g. on Windows until the ACL is verified:
"Power switch locked: operator must verify okkin-power.json ACL and set AO_OKKIN_POWER_WINDOWS_ACL_OK=1".

### Seat map (`.agent-office/seat-map.json`)

Seat-provider turns (a desk or the meeting room sending to the bridge outbox) belong to no crew seat until this gitignored file names one. The committed `.agent-office/seat-map.example.json` shows the shape with placeholder ids only:

```json
{
  "floor-1:desk-1": "seat-1",
  "floor-1:desk-2": "seat-2",
  "floor-1:meeting-room": "seat-1"
}
```

Each key is `<floorId>:<deskOrMeetingId>`, the same pair as the item title `seat:<floorId>:<deskOrMeetingId>` in the owner's outbox view. Each value must be a crew seat id (`seat-1` … `seat-9`, `okkin`); anything else is ignored. Copy the example to `seat-map.json` and replace the ids. An unmapped turn is stamped `seat: null`: no seat token sees it, and the owner's Kavi outbox board labels it **not mapped to a crew seat**.

### What a non-owner sees

A session that has not unlocked owner gets neutral grey notes, not errors: the crew talk thread says *Crew threads are private — unlock owner to see them.*, the talk input is disabled and says *Unlock owner to talk* (a 403 on send shows the same text), and the Kavi outbox board (roster → **Kavi outbox**) says *The Kavi outbox is private — unlock owner to see it.*

