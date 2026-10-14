# Configuration

Back to the [README](../README.md).

## Where the office keeps things

The office keeps its data in `~/agent-office` (`--home` or `AGENT_OFFICE_HOME` to move it) and clones projects next to it, as `~/agent-office/<owner>/<repo>`. To clone them somewhere else, like `~/Workspace`, an admin picks the **Workspace folder** in ⚙️ Settings → **🏢 Building** (or start with `--projects` or `AGENT_OFFICE_PROJECTS`). Floors you already have stay where they are, and a checkout of the same repository that's already in the new folder is used as it is. The building's map is in `~/agent-office/.agent-office/map.json`, and maps of your own go in `~/agent-office/.agent-office/maps/` (see [Maps](maps.md)). The list of floors is `~/agent-office/.agent-office/floors.json`, and each account's own Claude and GitHub sign-ins are in `~/agent-office/.agent-office/homes/<account>/` (revoking the account deletes them). Each floor keeps its workers, queue, pictures and worktrees in its own checkout's `.agent-office/`. The community work pool on that floor is `work-pool.json`, and the bot tokens that may claim from it are `work-pool-callers.json` (hashes only, plus a caller id). Who may approve, post levels 1–3 or 6–7, claim above level 3, or act as Dan or Okkin is `work-pool-policy.json` in that same folder: `approvers`, `lowLevelPosters`, `highLevelPosters`, `crew`, `dan`, and `okkin`, each a list of account ids or caller ids. A missing file allows nobody, so a Dan pass and owner approval both refuse. The names `dan` and `okkin` cannot be used as a caller or an account. Further names to refuse are `reservedNames` in that policy file, which stays out of git. These files are written atomically and end up mode `0600`.

Already have a checkout? Pick its repository anyway: a checkout of it that's already where the workspace folder would clone it is used as it is. You can still start the office in a project, `agent-office ~/code/my-project`: that project becomes a floor, and the office keeps its data in `~/code/my-project/.agent-office` as it did before there were floors. An office that already ran in a project carries on in it when you start `agent-office` there again. An admin can take that project off the building in the elevator like any other floor.

## HQ status files

The unblock strip and **Since last visit** read four files in the office data directory (the floor’s `.agent-office/` when the office was started in a project, otherwise `~/agent-office/.agent-office/`). All four are gitignored. They hold titles, seats, and states. A record with a `body`, `essay`, `text`, `note`, or `markdown` field is ignored.

`hq-local.json` maps desks to generic seat keys. Leave a name out of the repo; put it only in this file, on the machine. In the same `seats` object, a key that is a crew seat id (`seat-1` … `seat-9`, or `okkin`) maps that crew seat to a desk instead (see Local crew below) and is not a seat key here.

```json
{
  "crewKeysLower": ["seat-a", "seat-b"],
  "humanAliases": [],
  "humanMapsTo": "operator",
  "seats": { "desk-1": "seat-a", "desk-2": "seat-b" }
}
```

`humanMapsTo`, when it is a single token such as `operator`, is the strip’s heading (`Needs operator`). Blank stays **Needs a decision**. Seat values that are not a short token (`seat-a`, `desk-1`) are dropped.

`unblock.json` is the queue. `actionable` must be true, `kind` is `yesno` or `talk`, and `title` is one line of at most 80 characters. **Yes** / **No** on a `yesno` row types `1` or `2` into the desk stored on that block (a live row uses the id after `live:`). The desk must be waiting for input right then, and the tap must still carry that desk’s `at` and title. A `talk` row never types. The block moves onto `answered`, with the signed-in account id in `by`.

```json
{
  "updatedAt": "2026-10-06T12:00:00.000Z",
  "blocks": [
    { "id": "b1", "seat": "seat-a", "title": "Approve npm test", "kind": "yesno", "actionable": true, "at": 1710000000000, "workerId": "w1" }
  ],
  "answered": [{ "id": "b1", "answer": "yes", "at": 1710000001000, "by": "account-id" }]
}
```

`board-status.json` is the morning delta’s file source. `state` is `done`, `progress`, or `blocked`. Lines at or before the last visit are left out. Each group shows at most six lines, newest first, then grouped by seat. Desks and queue tasks are added the same way: a done desk, a desk that is actually working, a desk that needs input, a finished queue task, a running queue task. The task prompt is not read.

```json
{
  "updatedAt": "2026-10-06T12:00:00.000Z",
  "items": [
    { "id": "t1", "seat": "seat-a", "title": "Ship the queue", "state": "done", "at": 1710000000000 }
  ]
}
```

`last-visit.json` is `{ "at": 1710000000000 }`. The panel writes it when you close it. The first open, with no stamp, uses the last twelve hours.

The bridge accepts these on `POST /api/bridge/unblock` (`{ "blocks": [] }`) and `POST /api/bridge/board-status` (`{ "items": [] }`), with the same token or office session as the other bridge routes, and only from `127.0.0.1` or `localhost`. `GET /api/bridge/hq-brief?since=` returns the strip and the digest. `POST /api/bridge/unblock/answer` is signed-in office session only (a bridge token or `Authorization: Bearer` is rejected). The body is `{ "id", "answer": "yes"|"no", "at", "titleHash" }`. A `workerId` in that body is ignored. The server types only when the block is `yesno`, that desk’s status is `needs_input`, and `at` plus `titleHash` still match the live desk.

## Command line

```
agent-office [dir] [options]

      --home <dir>        Where the office keeps its data without a [dir] (default ~/agent-office)
      --projects <dir>    Where new floors are cloned, as <dir>/<owner>/<repo> (default ~/agent-office;
                          also settable from ⚙️ Settings)
  -p, --port <n>          Port (default 4600, env PORT)
  -H, --host <addr>       Bind address (default 127.0.0.1; 0.0.0.0 lets your network in).
                          HOST in the environment is ignored. See FORGEL-BIND.md.
      --password <pw>     Deprecated (visible in process listings). Use env
                          AGENT_OFFICE_PASSWORD, or AGENT_OFFICE_PASSWORD_FILE
                          (an owner-only file holding the password).
      --no-open           Don't open the office in your browser when it starts
      --agent <cmd>       Default agent command (default "claude")
      --agent-args <str>  Extra args for the configured agent, e.g. "--model opus"
      --dsh-profile <n>   DeepSeek Harness profile over ACP (default "acp")
      --tls-cert <file>   Serve HTTPS with this cert…
      --tls-key <file>    …and key
      --self-signed       Serve HTTPS with a generated self-signed cert
      --trust-proxy       Trust X-Forwarded-* (behind Caddy/nginx)
      --turn <url>        Add a TURN server for voice, e.g. turn:user:pass@host:3478
                          (env AGENT_OFFICE_TURN, several separated by spaces)
      --budget <usd>      Daily tracked Claude Code budget (OpenCode/Codex/Grok/Muse/DSH excluded)
      --budget-pause      ...and nobody can hire a new worker until the next day
      --max-workers <n>   Run at most n workers at once, across every floor (env AGENT_OFFICE_MAX_WORKERS)
      --webhook <url>     Post to this Slack / Discord webhook when a worker needs input or finishes
      --city <name>       Put the office in a real city: its sun and live weather (open-meteo.com)
      --weather <kind>    Pin the weather: clear, cloudy, rain, storm, snow or fog
      --real-time-sky     Start the sky on the real clock, not a day an hour (env AGENT_OFFICE_SKY_CLOCK=real; ⚙️ Settings can switch it)

agent-office setup [--projects <dir>] [--project <owner/repo>]... [--home <dir>]

  The first-start walkthrough again: the workspace folder, GitHub sign-in and
  repositories to clone as floors. With --projects / --project it asks nothing.
  Run it while the office is stopped.

agent-office prune [dir] [-n|--dry-run] [-f|--force]

  Removes leftover worker worktrees under .agent-office/worktrees/ and their
  office/* branches, in one floor's checkout (dir). Anything with uncommitted changes or unpushed commits is
  kept unless --force is given. A worker across several projects has worktrees of them in its
  own floor's workspace: prune each project to clear those out.

agent-office accounts [list | invite [name] [--admin] | revoke <name> | role <name> admin|member | password on|off] [-d <dir>]

  Invite, list and revoke people's own accounts, and switch the shared password
  off or on. Works while the office runs.

agent-office tunnel [office@address | url] [--port <n>] [--office-port <n>] [--name <name>] [--no-open] [--insecure] [-- <ssh options>]

  On your own computer, for an office that runs somewhere else: every web server
  a worker starts there opens on the same port here, by itself, and closes when
  the worker stops it. Given an SSH address it opens the tunnel to the office too.
  See docs/tunnel.md.
```

## Local model for the huddle

The meeting room and the three front desks can ask a model on this machine. `OLLAMA_URL` defaults to `http://127.0.0.1:11434`. `OKKIN_MODEL` is unset until you set it (a doc example is `qwen3.5:9b`). The host has to be `http://127.0.0.1`, `http://localhost`, or `http://[::1]`. `https` is refused. `localhost` is rewritten to `127.0.0.1` before any request, so the office does not ask the system resolver for it. Any other host is refused and the seat stays **offline**. The same two fields can live in `.agent-office/ollama.json`; the environment wins. The office only calls `GET /api/tags`, `POST /api/chat`, and `POST /api/generate` on that origin, plus `GET /api/ps` for Okkin's model switch (see Local crew below). It does not install a CLI, take a key, or open a route that proxies the model. The browser is told the configured model name and `ready` or `offline`, never the raw response. When the probe succeeds and a model is set, those seats use it. Otherwise they queue on the bridge outbox for a real crew bot. If that outbox directory cannot be written either, the seat says **no provider — needs owner**. A bridge route that fails answers `The office could not complete that`, not the exception text.

### Seat tokens (bridge identity)

Every crew bot that speaks or sets presence on the bridge needs its own seat token. Issue, rotate,
revoke or list them locally:

```
npx tsx scripts/seat-token.ts issue <seat-id>    # prints the token once
npx tsx scripts/seat-token.ts rotate <seat-id>   # new token, old one stops working
npx tsx scripts/seat-token.ts revoke <seat-id>
npx tsx scripts/seat-token.ts list
```

Only a sha256 hash is stored, in `.agent-office/seat-tokens.json` (mode 0600, gitignored). Send the
token as `x-bridge-token` or `Authorization: Bearer`. The seat comes from the token only:
`POST /api/bridge/say` posts as that seat (the account badge comes from the token), a `name` in the
body that is a different seat is rejected with 403, and `POST /api/bridge/status` and
`/api/bridge/crew-status` can only set the caller's own seat. A presented token that matches nothing
is 401.

**Migration:** the shared `bridge-token` is now read-only. It still works for `GET` bridge routes,
and any `POST` with it is 403. `say`, `status` and `crew-status` need a seat token (an office
session gets 403 there too). Other bridge POSTs accept a seat token or an office session.

## Local crew

See [Local HQ](hq.md). The floor's gitignored `.agent-office/hq-local.json` turns desks into crew seats. `seats` maps a crew seat id (`seat-1` … `seat-9`, `okkin`) to a desk; its other keys are the unblock strip's desk-to-seat-key map above. `names` maps a seat to a display name on this machine; without it the roster says `seat-1` … `seat-9`. The office data directory also holds `bridge-token` (created if it is missing, mode 0600), `ollama.json` (optional loopback `url` and `model`), `crew-status.json`, `chat-outbox.jsonl`, `chat-inbox.jsonl`, `talk-threads.json`, `desk-cards.json`, `kavi-feed.json`, and `kavi-outbox.json` (the last two mode 0600; the outbox keeps 200 items). Bot lines for a generic seat are posted to `POST /api/bridge/inbox`. `POST /api/bridge/talk` (every seat) and the model switch are owner only: a verified office session that has unlocked owner; any bridge, seat or Bearer token is refused, and so is a session that has not unlocked owner. Crew talk threads and the Kavi outbox are readable by the owner, or by a seat token for its own seat only; the shared bridge token is refused (see [Local HQ](hq.md)). Seat-provider turns reach a crew seat only through the gitignored `.agent-office/seat-map.json` (`{"<floorId>:<deskOrMeetingId>": "<crewSeatId>"}`; see the committed `seat-map.example.json`); unmapped turns are owner-only. JSON bodies over 16 KB are refused with the connection closed.

| Variable | Meaning |
| --- | --- |
| `OLLAMA_URL` | Loopback Ollama origin, `http` only. Unset uses `url` in `.agent-office/ollama.json`, then `http://127.0.0.1:11434`. `localhost` is rewritten to `127.0.0.1`. `https` and any other host are refused. |
| `OKKIN_MODEL` | The tag Okkin talks with. Not set in source. |
| `OKKIN_MODEL_ALLOW` | Comma-separated tags the desk may switch to. Intersected with the tags Ollama has installed. |

`OLLAMA_URL` wins over `ollama.json`. `hq-local.json` does not set the URL. A request cannot set the URL or add a tag.

### Kavi's desk (bridge folder twin)

`AGENT_OFFICE_KAVI_BRIDGE_DIR` points at a local copy of the bridge folder with `in/` and `out/`
subfolders. `GET /api/bridge/kavi-desk` (bridge token or office session, loopback Host only) returns
counts and newest timestamps only: `unconfigured`, `unreachable`, `quiet`, `waiting` (newest packet is
inbound) or `answered`. It never reads packet text, returns file names, writes, or calls any service.
`live` is always `false`: this is not a live call.

### Writing to Kavi (to-kavi)

The **Write to Kavi** panel drops a note or a file into `<AGENT_OFFICE_KAVI_BRIDGE_DIR>/to-kavi`, the
Kavi-George Bridge folder that Google Drive for desktop syncs on this machine. Drive sync does the
upload; the office holds no Google OAuth token, refresh token or service-account key.

- `POST /api/kavi/message` (JSON `{ text }`, 4000 characters max) and `POST /api/kavi/file`
  (`application/octet-stream`, name in `X-File-Name`, 10 MB max, types pdf png jpg jpeg gif webp txt md
  csv json docx xlsx pptx) need a signed-in office session, a loopback Host and a same-origin request.
  Any bridge, seat or shared token on the request is refused.
- Files are created only (`wx`): an existing name gets ` (2)`, ` (3)` and so on. Nothing is overwritten,
  deleted or listed. Names with separators, `..`, a leading dot or control characters are refused, and
  `to-kavi` must be a real folder (not a symlink) directly inside the bridge folder.
- `AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID` holds the Bridge folder's Drive id (for example
  `FAKE_folder_id_example_0000`; keep the real one in the machine's environment, never in the repo).
  The bridge root must hold a one-line `.bridge-folder-id` file with the same id. Sends are refused when
  the variable is unset or the marker does not match, and the screen offers no Drive link without it. `GET /api/kavi/bridge` and every send return only that id.
  This is a local marker check, not a Drive API call.
- Anything under `Documents\Major Files` is refused before it is read.
- Not a live call: Kavi answers later through the Bridge. The panel never shows a made-up reply.

### Kavi's desk computer (conversation)

Clicking Kavi's desk computer, or the **Kavi's screen** button, opens her screen as a modal. Notes go
through `POST /api/kavi/message` (above). `GET /api/kavi/thread` (office session, loopback Host) merges
the owner's notes from `to-kavi/owner-to-kavi-*.md` with Kavi's replies from
`<AGENT_OFFICE_KAVI_BRIDGE_DIR>/to-george/*.md|*.txt`, oldest first, each with its file time. The path
is checked for Major Files before any filesystem call. The screen polls every 20 seconds while open.
It is not a live call and never shows a typing indicator. Escape closes it and focus stays inside while open.

## Office password without the command line

`--password` on the command line shows up in any process listing, so it is deprecated.
The server reads the password in this order: `AGENT_OFFICE_PASSWORD`, then
`AGENT_OFFICE_PASSWORD_FILE` (a path to an owner-only file; surrounding whitespace is
trimmed; a blank file is refused), then `--password` with a one-line warning. The value is never printed.

```sh
# environment variable
AGENT_OFFICE_PASSWORD='<office-password>' agent-office

# owner-only file (POSIX: group/world-readable files are refused)
umask 077; printf '%s\n' '<office-password>' > ~/.config/agent-office/password
AGENT_OFFICE_PASSWORD_FILE="$HOME/.config/agent-office/password" agent-office
```

```bat
rem Windows: keep the file in %LOCALAPPDATA%\agent-office, readable by your account only
set "AGENT_OFFICE_PASSWORD_FILE=%LOCALAPPDATA%\agent-office\password.txt"
agent-office
```

A file under Documents\Major Files is always refused. See [launcher-password.md](launcher-password.md)
for a `start-office.cmd` example.
