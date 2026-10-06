# Configuration

Back to the [README](../README.md).

## Where the office keeps things

The office keeps its data in `~/agent-office` (`--home` or `AGENT_OFFICE_HOME` to move it) and clones projects next to it, as `~/agent-office/<owner>/<repo>`. To clone them somewhere else, like `~/Workspace`, an admin picks the **Workspace folder** in ⚙️ Settings → **🏢 Building** (or start with `--projects` or `AGENT_OFFICE_PROJECTS`). Floors you already have stay where they are, and a checkout of the same repository that's already in the new folder is used as it is. The building's map is in `~/agent-office/.agent-office/map.json`, and maps of your own go in `~/agent-office/.agent-office/maps/` (see [Maps](maps.md)). The list of floors is `~/agent-office/.agent-office/floors.json`, and each account's own Claude and GitHub sign-ins are in `~/agent-office/.agent-office/homes/<account>/` (revoking the account deletes them). Each floor keeps its workers, queue, pictures and worktrees in its own checkout's `.agent-office/`.

Already have a checkout? Pick its repository anyway: a checkout of it that's already where the workspace folder would clone it is used as it is. You can still start the office in a project, `agent-office ~/code/my-project`: that project becomes a floor, and the office keeps its data in `~/code/my-project/.agent-office` as it did before there were floors. An office that already ran in a project carries on in it when you start `agent-office` there again. An admin can take that project off the building in the elevator like any other floor.

## HQ status files

The unblock strip and **Since last visit** read four files in the office data directory (the floor’s `.agent-office/` when the office was started in a project, otherwise `~/agent-office/.agent-office/`). All four are gitignored. They hold titles, seats, and states. A record with a `body`, `essay`, `text`, `note`, or `markdown` field is ignored.

`hq-local.json` maps desks to generic seat keys. Leave a name out of the repo; put it only in this file, on the machine.

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
      --password <pw>     Office password (env AGENT_OFFICE_PASSWORD)
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

agent-office tunnel [office@address | url] [--port <n>] [--office-port <n>] [--name <name>] [--password <pw>] [--no-open] [--insecure] [-- <ssh options>]

  On your own computer, for an office that runs somewhere else: every web server
  a worker starts there opens on the same port here, by itself, and closes when
  the worker stops it. Given an SSH address it opens the tunnel to the office too.
  See docs/tunnel.md.
```
