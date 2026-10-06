# Providers

Back to the [README](../README.md). The seats that already exist are described in [Local HQ](hq.md).

This page is the plan for review. It does not change the running office. The provider model is **additive, opt-in per seat, zero change to existing seats**.

The office is the 1:1 meeting place for every bot the owner runs, across providers, and it has to keep working when those bots cover hundreds or thousands of projects. A seat is one adapter. The adapter reports honest status. The current crew desks, Okkin, the bridge, and kavi stay byte-for-byte as they are. Nothing in the current ten seats is migrated. An existing seat may be wrapped later, only in a later draft after its own review, and not by this plan's first code.

No new API key, account, or install happens without the owner's own Yes. The sections below are direction. Building each phase still needs that Yes. This page does not carry it, and a relay file does not carry it.

## Current state (audited)

Read-only, at these tips. Nothing here is a behavior change.

| PR | Branch @ sha |
| --- | --- |
| main | `main@a08bc78` |
| #7 | `forgel/core-hq@5c2ae276` |
| #8 | `cursor/gh-boards-fail-closed-3e5e@15f8f0c0` |
| #9 | `cursor/unblock-queue-digest-016d@8d73331e` |
| #10 | `cursor/huddle-ollama-64e4@559f5d96` |
| #11 | `cursor/hq-crew-okkin-7ab2@cf6500cc` |
| #12 | `cursor/community-work-pool-fb60@d376d8cb` (branch tip while auditing was `760c628`; the seven levels are the same array) |

### Where a seat gets a state

`main@a08bc78` has hired workers only. `WorkerStatus` is `starting`, `idle`, `working`, `needs_input`, `done`, `exited`, `offline` (`src/shared/protocol/workers.ts:6-13`). There is no crew seat, no roster chip, and no `stale`. `lastInput.at` is the last input time when a hook or a person typed (`src/shared/protocol/workers.ts:92` on #11; the field exists on main). A quiet shell goes idle after 12s. Nothing records a per-bot `lastEventAt` that survives a file re-read.

`#7@5c2ae276` adds bridge presence for **shells**. `applyCrewPresence` (`src/server/workers/crew.ts:46-73`) maps a name to `working` or `idle` and skips `needs_input`. A working push sets `lastInput` to `{ by: 'crew-status', at: Date.now() }` (`crew.ts:64`). Re-reading `crew-status.json` (`crew.ts:81-86`) calls that again, so the stored time is the read, not the push. The lease is 15 minutes (`crew.ts:10`), then `tickWorkingLease` (`crew.ts:96-109`) sets `idle`. There is no `stale` and no `offline` chip. `POST /api/bridge/status` accepts `{ name: string, status: "working" | "idle" }` (`src/server/http/routes/bridge.ts:193-208`). `POST /api/bridge/crew-status` accepts `{ crew: Record<string, string> }` and writes `{ updatedAt: string, crew, source: "bridge" }` (`bridge.ts:150-175`). No `seen` map.

`#8@15f8f0c0` does not change `crew.ts`, `bridge.ts`, or `hq.ts` relative to #7.

`#9@8d73331e` adds the morning delta and the unblock queue (`docs/configuration.md:40` and `:53`, `GET /api/bridge/hq-brief`). A bridge token cannot approve. `board-status.json` lines are `done`, `progress`, or `blocked`. That is a digest, not a per-bot `lastEventAt`. `crew.ts` gains a seat map for the digest; it does not add `stale`.

`#10@559f5d96` is the huddle branch (PR #10). `SeatBoard.probedAt` (`src/server/seat-provider.ts:49`, refreshed at `:90-91`) only throttles probes. It is not a per-run event time. Faces are a label string: `offline`, `no provider — needs owner`, `bridge`, or queued (`seat-provider.ts:160-167`). No shared state enum.

`#11@cf6500cc` is the crew-seat code this plan stacks on. `WorkerStatus` adds nothing to the main union; `WorkerKind` adds `crew` (`src/shared/protocol/workers.ts:6-15`). Roster chips are separate: `working`, `blocked`, `idle`, `done`, `stale`, `offline`, `switching` (`src/shared/hq.ts:111`). `rosterChip` (`hq.ts:114-127`) uses `beat.at`. Decay for a `working` beat: under 15 minutes `working` (`WORKING_LEASE_MS`, `hq.ts:16`), from 15 to 30 minutes `idle`, from 30 to 45 minutes `stale` (`STALE_AFTER_MS`, `hq.ts:19`), at 45 minutes `offline` (`OFFLINE_AFTER_MS`, `hq.ts:20`). Any other beat is `stale` at 30 minutes and `offline` at 45. `blocked` never decays. A missing or future `at` is `offline`.

`writeCrewPush` (`src/server/workers/crew.ts:90-102`) stores `seen[seat] = now` on the push and does not refresh it when the file is re-read (`tickCrewStatusFile`, `crew.ts:158-164`). Okkin is not in that file. `applyCrewPresence` (`crew.ts:111-142`) paints crew seats only, never shells. `working` applies only when `seen` is inside the 15-minute lease. `blocked` sets `needs_input` with `lastInput.by = 'crew-status'` and `at` from `seen` (`crew.ts:125-127`). A later push clears that needs-input. A `needs_input` from any other `by` stays. Chat does not set working (`crew.ts:153-156`). The lease timer (`crew.ts:193-203`) drops `working` to `idle` after 15 minutes. It does not itself write `stale` or `offline`; those exist on the roster chip only.

Okkin's chip (`src/server/hq/okkin.ts:8` and `:50-55`) is `offline`, `switching`, `working` (only while a chat is in flight, `depth > 0`), or `idle`. `syncOkkin` (`crew.ts:170-186`) maps `working` and `offline` through, and maps `switching` to idle with an activity string. While the chip is `working` it sets `lastInput.at` to `Date.now()` on that tick (`crew.ts:181`), which is the tick, not the request's start. There is no stored time for the last successful probe.

`#12@d376d8cb` is the work pool. It does not replace seat status. `LEVELS` is seven entries (`src/shared/pool.ts:50-58`). `PoolStatus` is `open`, `claimed`, `needs_approval`, `done` (`pool.ts:36`). Okkin is capped at level 3 (`pool.ts:106`). A job with no level defaults to 4 (`pool.ts:96`), which that cap cannot claim. Keywords only raise the floor (`pool.ts:97`, `src/shared/pool-keywords.ts`). Level 4 and above is where the text names network, a shell or a command (`curl`, `ssh`, `rm`), a URL, a path, code, money, a send or a message, an account, or a secret. Those seven levels are the claim rules. They replace any open-versus-gated two-tier wording. The code does not, by itself, give anyone a Yes.

### Okkin models

No model tag is hardcoded. `qwen3.5:9b` appears once, as a doc example on `#10` (`docs/configuration.md:69`). It is not in `#11` source.

On `#11`, the configured tag is `OKKIN_MODEL`, else `model` in gitignored `ollama.json`, else `hq.okkinModel`, else empty (`src/server/hq/okkin.ts:65-70`, `src/server/ollama.ts:79`). The allowlist is `OKKIN_MODEL_ALLOW`, else `hq.okkinAllow`, split on commas and checked with `modelTagOk` (`okkin.ts:70-74`, `src/shared/hq.ts:279-280`). `modelTagOk` checks length and path characters. It is not a list of tags. The switch list is that allowlist intersected with names from live `GET /api/tags` (`modelChoices`, `hq.ts:269-276`; applied in `okkin.ts:112`). Installed tags are read live. The allowlist is not.

### Bridge packets, and what the contract still lacks

`#11` `POST /api/bridge/crew-status` body is `{ crew?: Record<string, string> }` (`src/server/http/routes/bridge.ts:260`). The file and the response add `updatedAt` (ISO string), `seen` (seat id to epoch ms), and `source` (string) (`bridge.ts:275`, `crew.ts:100`). `POST /api/bridge/status` body is `{ name: string, status: "working" | "idle" }` (`bridge.ts:299-304`). Seat id is the key. There is no `provider`, `task`, `projectId`, or `botId`.

`POST /api/bridge/kavi-feed` body is `{ titles?: { name?: string, id?: string, modifiedTime?: string }[] }` (`bridge.ts:325-332`). The file is `{ updatedAt: string, source: "bridge", allowlist: string, titles }` (`bridge.ts:334-338`). `id` is an optional string on a title, not a bot id. There is no state, no `lastEventAt` per bot, no task, and no `projectId`. The outbox items are `{ title, text, at }` plus a note string. That feed cannot fill the status contract below without a shim that leaves those packets as they are and sets the missing fields to empty.

## What stays

These keep their current behavior. The plugin does not edit them, replace their routes, or move them onto the registry:

- Crew desks and the gitignored desk map (`seats` as seat id to desk id).
- Okkin, including the loopback Ollama client in `src/server/ollama.ts`, the model switch, and the rule that WORKING is only a real `/api/chat` in flight.
- Bridge auth, crew-status, inbox, talk limits, and the 16 KB body cap (413).
- The kavi bridge folder, the feed, and the outbox. Read-only status. No Drive token on the host.

`src/server/workers/manager.ts` stays at or under 1005 lines. The plugin does not add code to `manager.ts`, `server.ts`, `main.ts`, the state store, `protocol.ts`, or another feature's files. The worker CLI registry already in `src/server/providers/` (`PROVIDERS`, used when hiring a desk agent) stays as it is. Seat adapters are new files beside it, under `src/server/providers/seats/`, with their own registry. No new dependency unless it is trivial and called out in that phase's review.

With no plugin entries, the roster, the desks, and the bridge match today's office.

## Seat

A plugin seat is:

```ts
type ProviderId =
  | 'claude-cli'
  | 'cursor-cloud-agent'
  | 'openai'
  | 'grok-bot-bridge'
  | 'ollama'
  | 'kavi-bridge';

type SeatTier = 'resident' | 'guest' | 'hidden';

type Seat = {
  id: string;
  displayName: string;
  provider: ProviderId;
  /** Provider-specific settings. Never a secret. */
  connector: Readonly<Record<string, unknown>>;
  tier: SeatTier;
};
```

`displayName` on a public checkout is the seat id. A local name may live in gitignored config. Before it is shown, a plugin `displayName` is run through the same look-alike fold as `POST /api/bridge/say`: format and mark characters stripped, case folded, look-alike letters mapped. A name that then contains `okkin` is not shown, and the label stays the seat id. The rejected string is not logged. `connector` is only the keys in the allowlist below.

The existing `seats` object is the desk map and remains the desk map. Plugin entries are a different list, `pluginSeats`, so a current `hq-local.json` still loads as it does today. Replacing `seats` with an array would drop desk bindings, and this plan does not do that.

Plugin seat ids use the `seat-N` form and MUST NOT be `seat-1` … `seat-9` or `okkin`. Those ids belong to the current seats.

## Seat tiers

Physical chairs are for persistent assistants. The floor does not grow a chair per run.

| Tier | Who | On the floor |
| --- | --- | --- |
| resident | Long-lived assistants: grok-bot-bridge, kavi-bridge, and the local model via ollama | A chair, opt-in, one entry each |
| guest | A small set of important cloud agents the owner assigns or pins | A spare chair, only while a pin fits under the cap |
| hidden | Short-lived task agents: Cursor cloud agents, Claude Code runs, and any run that was not pinned | No chair. A run or a count under its project on the summary board |

Rules:

1. A resident entry is allowed only for `grok-bot-bridge`, `kavi-bridge`, and `ollama`. Those are the long-lived assistants. Each one still needs its own `pluginSeats` entry. The current Okkin seat and the current crew desks are not that entry.
2. Guest chairs have a capped count. The default cap is 4. `guestChairCap` in gitignored `hq-local.json` may set another positive integer. The repo does not hard-code a list of guests. `hq-local.json` is owner-trusted (any ProArt process could edit it). A line in that file is not by itself a seated guest.
3. A run becomes a guest only by an owner pin, and the pin is a session action in the UI. A `pluginSeats` entry with `"tier": "guest"` is a request. The chair is seated only after an office session confirms that pin. Starting a run does not write a pin. A pool claim, a bot line, and a file edit do not confirm one.
4. When guest chairs are full, a new confirmed pin is kept as waiting and the agent stays a hidden run. It does not take a chair from someone already seated. When a guest chair frees, the office seats a waiting pin only if that pin already has a session confirm. A file line alone is not a confirm. The office does not invent one.
5. Task agents never receive a chair on their own. `claude-cli` and `cursor-cloud-agent` default to hidden. `openai` defaults to hidden. Any of them may sit as a guest only by an owner pin, and only while the cap allows.
6. Hidden runs are absent from the floor, the desk roster, and the walking cast. Their honest status appears as runs or counts on the project summary (phase B). A hidden run is not painted WORKING unless that run is really in flight.

`tier` omitted means the provider default in the table below. An entry that asks for `resident` on a task provider is refused and stays hidden. An entry that asks for a chair on an unknown provider is refused.

## How to plug in a new bot

Three steps, for a resident or for an owner pin. Task agents skip this. They do not get a chair.

1. Add one object to `pluginSeats` in gitignored `.agent-office/hq-local.json` (next to that floor's `workers.json`). Leave the existing `seats` desk map as it is.
2. Restart the office. The registry loads that list and no other seat list.
3. A resident shows its provider and an honest chip (`not connected — needs owner`, offline, idle, or working). A guest appears only after the session confirm, and only while the cap allows. Anything else stays a hidden run.

```json
{
  "pluginSeats": [
    { "id": "seat-10", "provider": "ollama", "tier": "resident" }
  ],
  "guestChairCap": 4
}
```

A guest request uses `"tier": "guest"` and a provider id. It stays hidden until the session confirm. A local `displayName` is optional, stays in this file, and still has to pass the say-name fold above.

### Connector allowlist

Each adapter allowlists its connector keys. The seat entry itself allowlists `id`, `displayName`, `provider`, `tier`, and `connector`. Any other key, at any depth, refuses the whole entry. The entry is not loaded, the value is not logged, and the seat is not created.

| provider | connector keys |
| --- | --- |
| claude-cli | none (`connector` omitted or `{}`) |
| cursor-cloud-agent | `enabled` (boolean) |
| openai | `enabled` (boolean), `model` (a model tag), `maxTokens` (an integer from 1 through the adapter ceiling) |
| grok-bot-bridge | none |
| ollama | `model` (a model tag already allowed for the local client) |
| kavi-bridge | none |

`url`, `baseUrl`, `endpoint`, `host`, and `proxy` are not on any allowlist, at any depth, in any casing. A string value at any depth refuses the whole entry when it looks like a key: it begins with `sk-`, it begins with `Bearer`, or it is a long high-entropy string (24 or more characters, no whitespace, and not an allowed model tag). The value is not logged. `enabled: true` does not turn on a paid adapter. Only `AO_PAID_ENABLED=1` does that.

## Adapter

One adapter per provider. The registry rejects an unknown provider id. The seat is then `not_connected` with reason `not connected — needs owner`. It is never WORKING.

```ts
type ProbeStatus = 'offline' | 'not_connected' | 'idle' | 'working';

type ProbeResult = {
  status: ProbeStatus;
  reason: string;
  /** The words `yes` or `no` only. Never a prefix or suffix of a key. */
  keyPresent: 'yes' | 'no';
};

type TalkResult =
  | { kind: 'queued'; reason: string }
  | { kind: 'reply'; text: string };

interface SeatAdapter {
  readonly id: ProviderId;
  readonly defaultTier: 'resident' | 'guest' | 'hidden';
  probe(): Promise<ProbeResult>;
  talk(input: { seatId: string; text: string }): Promise<TalkResult>;
  /** In-flight run ids, when the provider has them. */
  runs?(): readonly string[];
}
```

Honest words are only `offline`, `not_connected`, `queued`, `idle`, and `working`.

- `offline` means the provider was reached for and did not answer (down, asleep, or refused).
- `not_connected` means the tool or the credential is absent. The reason shown is `not connected — needs owner`.
- `idle` means reachable, with no run in flight.
- `working` means a real run or request is in flight. The chip clears when that promise settles, including when it errors. A missing provider is never WORKING. Chat does not force WORKING. `probe()` never makes a paid call and never starts a run. In phase C a paid adapter's `probe()` is key presence only, or one documented free endpoint. That free endpoint still counts against the daily cap and is rate-limited.
- `queued` is a `talk()` result, not a chair and not a WORKING chip. The chip stays the last `probe()` status. The only office line added is the existing office-role notice that the message was queued. The office does not write a bot line.

A reply exists only when the provider returns text. The office does not synthesize a reply or a presence. `runs()` is empty unless a real run id exists. A project is `active` only when such a run exists (see Scale direction).

`needs_input` stays a status of the current crew bridge only. Plugin seats do not gain that chip. A plugin seat that needs the owner is `not_connected` with the reason above. A plugin run that is blocked and no longer in flight is `idle` or `not_connected`, with a reason, and is not WORKING.

Talk that can send as the owner is session-only, same bar as `POST /api/bridge/talk`: an office session, a bridge token refused, one line every 3 seconds, 20 lines a minute, body over 16 KB refused (413). Adapter replies are role `bot`. They are never role `player`.

## Per-provider design

### claude-cli

Default tier: hidden. A Claude Code run does not get a chair unless the owner pins a guest and the cap allows.

Status: `probe()` checks PATH with the same executable check the office already uses (`X_OK` on the resolved command). The command name is fixed as `claude`. The connector has no keys, so it cannot set a path or another command. Missing or not executable: `not_connected`, reason `not connected — needs owner`, `keyPresent: no`. Present: `idle` when nothing is spawned, `working` only while a spawned run is in flight. `probe()` does not spawn and does not make a paid call.

Talk is phase B. It is a tool run and it may cost money. It counts as paid (daily call cap, token cap, and the kill switch) unless the CLI is proven to be on a flat subscription. A PATH hit is not that proof. The proof is a file the owner wrote, not a guess from a successful run: gitignored `.agent-office/claude-cli-flat-subscription.json`, mode `0600`, in the same data directory as `hq-local.json`. The office reads it and does not create it, rewrite it, or log its body. It counts only when it is that path, that mode, and the JSON is `{ "flat": true }` with no other fields. Until that file is present, spawn happens only when `AO_PAID_ENABLED=1`. Missing, empty, or any other value means `talk()` returns `queued` and nothing is spawned.

Spawn rules:

- `execFile` only. No shell.
- The owner text is written to stdin. It is never placed in argv.
- Print / non-interactive mode. Tools and file edits are disabled. Enabling tools or file edits later needs its own security review.
- The child cwd is a fixed sandbox directory for this run, outside the owner's home documents and outside the protected personal folder. The cwd is not taken from the message or from the connector.
- Triggered only by an owner session, the same session bar as talk. A pool claim, a bot line, or a file change does not spawn.
- A timeout, an output byte cap, and at most one concurrent run. A second talk while that run is in flight is rejected.
- The child environment is a named allowlist, never a copy of the office process environment. The names are `PATH` and `CLAUDE_CONFIG_DIR` (the CLI's own config-dir variable, so it can find the login it already has). No other name is passed. `HOME` is not passed. No provider keys, no office session, no bridge token. Adding another name needs its own security review.

`probe()` does not spawn and does not make a paid call. It is the PATH check only. When the process exits, status leaves `working`. There is no synthesized assistant line.

Network: none. This adapter does not open a socket.

Env: `PATH` for the parent check. The child gets only the allowlist above (`PATH` and `CLAUDE_CONFIG_DIR`). This adapter does not read a provider key, and it does not read the config directory. The directory that `CLAUDE_CONFIG_DIR` names must not be the protected personal folder.

Failure: command missing, kill switch not exactly `AO_PAID_ENABLED=1` while the subscription is unproven, spawn error, timeout, output over the cap, or a non-zero exit with no text. Status stays honest. `talk()` returns `queued` when nothing was spawned. No bot line is written.

### cursor-cloud-agent

Default tier: hidden. Design only until phase C. A Cursor cloud agent does not get a chair unless the owner pins a guest and the cap allows. Short-lived runs stay hidden.

Status: `probe()` never makes a paid call and never launches an agent. Before phase C it returns `not_connected` and does not call the network. In phase C, `probe()` is key presence only (`key present: yes` or `no`), or one documented free endpoint. That free endpoint still counts against the daily cap and is rate-limited. `probe()` does not return `working`. A present key with `AO_PAID_ENABLED` missing or not exactly `1` is still `not_connected`, reason paid adapters off.

Launch is phase C, and it is code-tier and money-tier. Each launch needs an owner gate: a session confirm for that launch. A pool claim does not launch. Bot text does not launch. The talk text is data and is not the confirm. A launch also requires `AO_PAID_ENABLED=1`. Any other value, including a missing variable, means no call, even when a key is stored.

Network: none in phase A or B. No `fetch`. Phase C, after the owner's Yes for that key and only while `AO_PAID_ENABLED=1`, uses a fixed host allowlist baked into the adapter (the Cursor API host), `https` only, `redirect: 'error'`, a timeout, and a response byte cap. Paths are constants. The model name goes in the body only. The base URL is not read from config, from the seat, or from the message.

Env: Windows Credential Manager is the place to store the key. A user env var is a fallback only, because a user-scope env var is visible to every process running as that user. The value is never printed. Status shows `key present: yes` or `key present: no`.

Failure: missing key, `AO_PAID_ENABLED` not exactly `1`, cap exceeded, HTTP error, timeout, oversized body, or a launch with no session confirm. Each one is `offline` or `not_connected`. No retry loop. `talk()` without a confirmed launch returns `queued`.

### openai

Default tier: hidden. Design only until phase C. Same skeleton rules as `cursor-cloud-agent`. An important long-lived use may be pinned as a guest. A task call is a hidden run.

The only outbound host, in phase C, is `api.openai.com`. A user-supplied or "OpenAI-compatible" base URL is rejected. Paths are fixed. The model name goes in the body only. `max_tokens` is capped by a constant in the adapter. `maxTokens` in the connector may lower that cap and MUST NOT raise it.

`probe()` never makes a paid call. Before phase C it is `not_connected` and `fetch` is not called. In phase C it is key presence only, or one documented free endpoint that still counts against the daily cap and is rate-limited. A call that spends money also requires `AO_PAID_ENABLED=1`. Each such call needs the same owner session confirm as a Cursor launch: not a pool claim, and not bot text.

Env: Windows Credential Manager first. A user env var is a fallback only, because a user-scope env var is visible to every process running as that user. Same `key present: yes/no` rule.

### grok-bot-bridge

Default tier: resident. This is the long-lived assistant path that already uses the authenticated bridge.

A new resident is a new seat id in `pluginSeats`. The adapter reads that id from the existing crew-status file and inbox. It does not rewrite the file format, the bridge routes, or the current seats. WORKING follows the existing heartbeat lease for that id only: a fresh `working` push while the lease holds, then idle, stale, and offline as today. A push does not stamp "now" onto an old heartbeat. Chat does not force WORKING.

Talk for that new id uses the existing outbox and inbox. A bot line appears only when inbox text arrives for that id. Otherwise `talk()` returns `queued` and the office line is the existing queued notice.

Network: loopback only, the existing bridge host allowlist (`127.0.0.1` on the office ports). No new listener. The shared bridge token is not a per-bot token. A bot token, if one is added later, is per bot and per seat, stored hashed, revocable, and unable to act as the player or the owner.

Env: none for a provider key. Bridge gate stays as it is.

Failure: no heartbeat is `offline`. A blocked crew-status on a current seat stays the current seat's behavior. The plugin seat does not copy another seat's heartbeat.

### ollama

Default tier: resident. A new local-model seat may opt in. Okkin is not that seat and is not rewired.

Status and talk go through the existing `src/server/ollama.ts` client. No second client. `probe()` uses the existing tags and ps reads and does not mark WORKING. `working` is only while a real `/api/chat` for this seat is in flight. Switching models is not WORKING. Unreachable, refused URL, or a machine that is asleep is `offline`.

Address: `OLLAMA_URL`, else gitignored `ollama.json`, else `http://127.0.0.1:11434`. `http` only, loopback only (`127.0.0.1`, and `::1` as the current client already allows). `localhost` is rewritten to `127.0.0.1`. Any other host is refused. Redirects are not followed. Response cap about 1 MB. Timeouts stay the current probe and chat timeouts. Allowed paths stay `/api/tags`, `/api/ps`, `/api/chat`, and `/api/generate`. The model name stays in the JSON body.

Env: `OLLAMA_URL`, `OKKIN_MODEL`, `OKKIN_MODEL_ALLOW`. The connector may name a model tag. The tag still has to sit in the allowlist intersected with installed tags. The connector cannot set the URL. A URL on a request is ignored.

Failure: the current Okkin failures (offline, no allowed model, 409 while a request is in flight). No pull, delete, create, copy, push, or raw proxy.

### kavi-bridge

Default tier: resident. Read-only status. The Drive workaround is unchanged.

Status comes from the existing local feed file the bridge already writes. The office does not call Drive. There is no Drive token on the host. Missing feed is `not_connected` or `offline`, not a synthesized presence.

Talk, when the owner uses it, writes to the existing bridge folder (the existing kavi outbox). A coordinator bot relays that folder to Drive. The office does not open a Drive session, and it does not add a listener.

Env: none. Network from this adapter: none.

Failure: unreadable feed is `offline`. The adapter does not invent titles or a bot line.

## Adapter table

| provider | status source | talk path | outbound hosts | key source | paid? | default state | default tier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude-cli | PATH `X_OK` on `claude`; no spawn on probe | phase B `execFile` on talk; queued if it cannot start | none | none (child env is only `PATH` and `CLAUDE_CONFIG_DIR`) | yes, unless `.agent-office/claude-cli-flat-subscription.json` proves a flat plan | `not_connected` until the CLI is on PATH; off unless `AO_PAID_ENABLED=1` or that file exists | hidden |
| cursor-cloud-agent | key presence, or one documented free endpoint in phase C; no paid probe | queued until a session-confirmed launch | Cursor API host, https, phase C only; none before that | Windows Credential Manager; user env var is fallback only | yes | off unless `AO_PAID_ENABLED=1` | hidden |
| openai | key presence, or one documented free endpoint in phase C; no paid probe | queued until a session-confirmed call | `api.openai.com` only, phase C; none before that | Windows Credential Manager; user env var is fallback only | yes | off unless `AO_PAID_ENABLED=1` | hidden |
| grok-bot-bridge | existing crew-status heartbeat for that seat id | existing outbox and inbox | loopback `127.0.0.1` bridge only | none (shared bridge token is not a bot token) | no | `offline` until a real heartbeat | resident |
| ollama | existing loopback tags and ps probe | existing `/api/chat` | loopback `http` on `127.0.0.1` (and `::1` as today) | none | no | `offline` if unreachable | resident |
| kavi-bridge | existing local feed file, read-only | existing bridge-folder outbox; a coordinator relays | none from the office | none on the host | no | `offline` or `not_connected` from the file | resident |

Paid rows stay off unless `AO_PAID_ENABLED` is exactly `1`. Missing or any other value means every paid adapter is off, even with a key present. `key present` is `yes` or `no` and is not a fragment of the key. Hidden is the default tier for task providers even if someone later pays for a call.

## Security requirements

These are normative. Later phases MUST meet them. A review that finds a break sends that phase back.

1. **Keys.** MUST NOT create a key or an account without the owner's own Yes. Provider keys live only on the host. Prefer Windows Credential Manager. A user env var is a fallback only, because a user-scope env var is visible to every process running as that user. Keys MUST NOT be written to the repo, `workers.json`, `hq-local.json`, any `.agent-office` file, the client, the websocket, logs, chat, or transcripts. The server uses a key only to build an outbound call. Status shows `key present: yes` or `key present: no` and never a prefix or a suffix.
2. **Outbound.** Each adapter has a fixed host allowlist. Cloud calls are `https` only, with `redirect: 'error'`, a timeout, and a response byte cap (Content-Length checked before the body is read, same bar as `src/server/ollama.ts`). Endpoint paths are fixed constants. The model name goes only in the body. Cloud adapters MUST NOT accept a base URL from the user, from config, or from the message. Local ollama stays loopback `http` as it is today.
3. **Money.** Paid calls happen only when `AO_PAID_ENABLED=1`. Missing, empty, or any other value means every paid adapter is off, even when a key is present. Okkin and ollama stay the only free default path and do not read this flag. `claude-cli` on talk is paid unless the CLI is proven to be on a flat subscription. Each paid call has a `max_tokens` ceiling (a local CLI run uses its output byte cap the same way). Each paid provider has a daily call cap and a daily token cap. Caps are constants; config may lower them and MUST NOT raise them. Spend is logged locally, mode `0600`, as provider, project, seat, time, and counts. The log MUST NOT contain the prompt, the key, or the message. No automatic retry loop. `probe()` MUST NOT make a paid call.
4. **Inbound.** MUST NOT open a tunnel, bind a public port, or add a listener. A cloud bot reaches the office only through the existing bridge folder, or by the office pulling outbound. A bot token is per bot and per seat, stored hashed, revocable, and MUST NOT act as the player or the owner or approve anything. The shared bridge token MUST NOT be used as that token. Anything that speaks as the owner stays session-only.
5. **Seats.** Honest status only (`offline`, `not_connected`, `queued`, `idle`, `working`), taken from real adapter state. The shared contract in Provider status contract adds `needs-owner` and `stale` as the one shape every provider reports. Chairs follow Seat tiers. Adapter replies are always role `bot`, never `player`. Bot text is data: chat MUST NOT trigger a tool run, a file write, or a send. Claim rules are the seven work-pool levels on PR #12 (`src/shared/pool.ts:50-58` at `d376d8cb`), per project. They replace any open-versus-gated pair. Okkin is capped at level 3 (`pool.ts:106`). A missing level defaults to 4 (`pool.ts:96`). Level 4 and above covers network, shell or commands (`curl`, `ssh`, `rm`), URLs, paths, code, money, sends or messages, accounts, and secrets. Levels 6 and 7 need the security reviewer's pass and then the owner's own Yes, each from someone other than the poster or the claimer. In that code, level 6 already waits on the pass before the Yes (`src/server/pool/pool.ts:220-256`). Level 7 waits on the Yes (`pool.ts:206`). This page does not supply either. Okkin's output is text only and never triggers a send or a run (`pool.ts:191`). An adapter is a claimer. It MUST NOT pass or approve its own job, or raise its own level.
6. **Privacy.** The only text sent to a cloud provider is the message the owner typed to that seat. Prior turns are not attached unless a later review says so. Other seats' threads and the outbox are never auto-forwarded. The owner's protected personal folder is excluded: an adapter MUST NOT read or send any file from that folder, and the folder is not named in the repo, in config samples, or in logs. Transcripts stay mode `0600` under `.agent-office/`, and are reviewed and pruned at 30 days.
7. **Public repo.** Generic seat ids and provider names only. MUST NOT commit account ids, emails, org ids, personal names, Drive ids, machine paths, or tokens. Docs and commit messages use "owner" and "needs owner".
8. **kavi-bridge.** The office writes to the existing bridge folder. A coordinator bot relays to Drive. MUST NOT put a Drive token on the host, and MUST NOT add a Drive client.

Rate limits from Local HQ still apply (talk spacing, 20 lines a minute, 413 over 16 KB). Paid caps sit on top of those limits. A failed call does not retry itself.

## Scale direction

The office is not built around one project. It has to scale to hundreds or thousands of projects, managed through it by many bots across providers. The floor stays small. The summary carries the scale.

### Project

A project is a first-class record:

```ts
type Project = {
  id: string;
  name: string;
  /** A repo reference, or none when the work has no clone. */
  repo: string | null;
  /** Seat ids. Not personal names. */
  ownerSeats: readonly string[];
  /** `active` only while a real run exists. Otherwise `inactive`. */
  status: 'active' | 'inactive';
  links: readonly string[];
};
```

Seats and projects are many-to-many. A seat can work several projects. A project can have several seats. The link is seat ids and project ids in gitignored config, not a table in the repo.

`status` is `active` only when `runs()` (or an in-flight promise) includes a real run for that project. A pin, a chat line, or a desk card does not make a project active.

`repo` and each `links` entry render only when the value is `http:` or `https:` and has no userinfo. Any other scheme, including `javascript:`, is omitted and not interpolated into the page. A rendered anchor uses `rel="noopener noreferrer"`.

### Registry

Projects are declared in gitignored local config, or read from the existing local board or pool, and loaded lazily when a summary page or a seat opens them. The repo ships no project list. Source MUST NOT contain a hard-coded array of projects. Absent config means an empty page, not a sample project.

### Status at scale

The office shows a summary: counts by status, Needs-owner items, and active runs, with filter and search. It does not draw 1000 desks. Rooms and chairs show the active subset only: residents, seated guests, and hidden runs that are actually in flight, capped to what the summary page asked for.

Status is pulled on demand (when the summary is opened) or by an event the process already has (a finished promise, or the existing crew-status file read). MUST NOT start a polling loop per project. A summary open reads the local index. It does not fan out a probe to every project. Probes of cloud adapters obey that adapter's rate limit and daily cap. Hidden runs contribute counts. They do not contribute chairs.

### Work pool and spend

The seven work-pool levels apply per project (PR #12, `src/shared/pool.ts:50-58` and `:96-108`). Okkin stops at level 3. A job with no level defaults to 4. Level 4 and above covers network, shell or commands, URLs, paths, code, money, sends or messages, accounts, and secrets. Levels 6 and 7 need the security reviewer's pass and then the owner's own Yes, from someone other than the poster or the claimer. Okkin's output is text only and never triggers a send or a run. A two-tier open-or-gated split is not the rule. Citing the pool is not a Yes.

Spend caps apply per provider and also per project. Either cap stops the next paid call. Paid calls still require `AO_PAID_ENABLED=1`; any other value stops all of them, even when a key is present. Ollama is unchanged and is not metered as a paid provider. A pool claim is not an owner gate for a paid launch.

### Storage

Records live in append-only files or a light local store under `.agent-office/`, mode `0600`, gitignored. The index is paginated. Memory holds the page being shown, not every project. MUST NOT keep an unbounded in-memory array of projects, runs, or transcripts.

Retention: transcripts and the spend log are reviewed and pruned at 30 days. Daily cap counters may keep one total per provider and per project for the current day, without the message text. A pruned record drops out of the index. Hidden-run rows follow the same 30-day rule once the run is finished.

### Honest status at every level

A seat is WORKING only while its adapter has a run in flight. A project is `active` only while a real run exists. A count on the summary is the number of those real states. Empty, unknown, and not-yet-loaded are not shown as active or WORKING.

## Provider status contract

Phase A0. This is the first build, before plugin chairs. It is direction until the owner's own Yes. This file is the only status contract. There is no second contract document. Every provider reports one shape. New providers plug in only through it. Existing seats adopt it by a shim that maps the fields in Current state and does not change their chips, leases, or who may post.

```ts
type ProviderState = 'working' | 'needs-owner' | 'idle' | 'offline' | 'stale';

type ProviderStatus = {
  botId: string;
  provider: string;
  state: ProviderState;
  /** Epoch ms of a real adapter or bridge event. Never a clock read, a timer tick, or a file re-read. */
  lastEventAt: number | null;
  /** Short title only. Never a body, a key, a file path, or a personal detail. Escaped when shown. */
  task: string;
  /** Short title only, or null. Same limits as task. */
  projectId: string | null;
};
```

`botId` is a seat id or a worker id, not a personal name. The words shown for `needs-owner` are "Needs owner".

Decay, for a provider that plugs in through this contract: while no real run is in flight, no heartbeat for 15 minutes (`WORKING_LEASE_MS`) moves `working` or `idle` to `stale`, and no heartbeat for 45 minutes (`OFFLINE_AFTER_MS`) moves it to `offline`. `needs-owner` does not decay. A real in-flight run stays `working`. `lastEventAt` comes only from a real adapter or bridge event. A clock, a timer, and a file re-read MUST NOT write it. The #7 read path stamps `Date.now()` (`src/server/workers/crew.ts:64`). The shim does not copy that stamp. The words shown for `needs-owner` are "Needs owner".

Each status carries the event set that wrote it: `bridge-token`, `office-session`, `adapter-run`, `ollama-probe`, `hook`, or `file-replay`. A `bridge-token` event cannot resolve `needs-owner` (it cannot move that state to anything else) and cannot mark an office-launched run done. An office session does those. The shim for existing seats still runs today's `applyCrewPresence`: a crew-status push may still set and clear a crew-status `needs_input`, because that is current behavior. The tag is stored beside it. New providers get the prohibition immediately.

### Mapping from the audit

The shim projects today's fields into `ProviderStatus` and leaves the current chip on screen.

| Today | Where | lastEventAt | Contract state |
| --- | --- | --- | --- |
| `working` and `seen` under 15 min | `#11` `hq.ts:120-121`, `crew.ts:131-136` | `seen[seat]` from the push (`crew.ts:98`) | `working` |
| `working` beat, 15–30 min | `hq.ts:122` | same `seen` | `idle` (shim keeps today's chip) |
| `working` beat, 30–45 min | `hq.ts:123` | same `seen` | `stale` |
| age at least 45 min, or no beat | `hq.ts:115-119` | missing or the old `seen` | `offline` |
| `blocked` / `needs_input` | `hq.ts:118`, `crew.ts:125-127` | `seen`, or `lastInput.at` | `needs-owner` (does not decay) |
| roster `done` | `hq.ts:126` | `beat.at` | `idle` |
| Okkin `working` (`depth > 0`) | `okkin.ts:53`, `crew.ts:180-181` | the sync tick is a timer, so the shim leaves this null unless the chat request itself recorded a start | `working` |
| Okkin `switching` | `okkin.ts:52`, `crew.ts:174-177` | none | `idle` |
| Okkin `offline` / `idle` | `okkin.ts:51-54` | no last-reachable stamp | `offline` / `idle` |
| Worker `needs_input` | `workers.ts:10` | `lastInput.at` when a hook set it | `needs-owner` |
| Worker `working` | `workers.ts:9` | `lastInput.at` | `working` while the process is in flight |
| Worker `done` / `idle` / `starting` | `workers.ts:7-11` | `lastInput.at` or null | `idle` |
| Worker `exited` / `offline` | `workers.ts:12-13` | none dedicated | `offline` |
| Kavi titles | `bridge.ts:325-338` | file `updatedAt` only | no per-bot row; shim does not invent one |

`task` and `projectId` are a short title only, or empty, or null. They are never a body, a key, a file path, or a personal detail. The shim copies a desk-card title or a worker task name only after that cut. `provider` is `grok-bot-bridge` for a crew seat, `ollama` for Okkin, `kavi-bridge` only when a later packet actually names that bot, and the worker's own provider id for a hired agent.

## Project index at scale

Phase B, with the task agent feed. Hundreds or thousands of projects are a searchable index, not rooms.

An index row is `{ projectId, name, ownerBot, state, lastActivity, needsOwner }`. `projectId` and `name` are short titles only, never a body, a key, a file path, or a personal detail. `ownerBot` is a bot id. `state` is a `ProviderState` from the status contract, or `inactive` when no real run exists. `lastActivity` is the latest real `lastEventAt` among the project's bots and runs. It is null when none exists. It is never a clock read or the time the index was opened. `needsOwner` is true when any of those states is `needs-owner`. The words shown are "Needs owner".

The server pages the index. Search is indexed on the server. Filters are bot, state, and needs-owner, applied on the server to the requested page. The browser does not receive every project. Memory does not hold an unbounded array.

The floor draws persistent bots only (residents, and guests that already have a session confirm). Projects are not desks, chairs, or other furniture. They appear in this index, on the boards, and in the coordinator console. Task agents do not get chairs. They roll up under their project and show in the task agent feed.

The index file is gitignored under `.agent-office/`, mode `0600`, with the same 30-day review for finished rows. No new listener. Bots cannot post index rows. A row does not launch a run.

## Task agent feed

Phase B. Hidden task agents get no chair. Cursor cloud agent runs, Claude Code runs, and any other hidden run show in this panel instead of on the floor.

The panel is a live feed styled like a trading-floor ticker, with a clean, calm, feng-shui look: a soft palette, gentle motion, and no flashing. Nothing blinks, strobes, or snaps between alarm colors.

Each run in the ticker shows a loading spinner while it is actually running. The spinner stops when a real finish event arrives.

- A real success becomes a check mark.
- A real failure becomes a failed mark, not a check.
- A real cancel becomes a cancelled mark, not a check.
- A timeout from the adapter is a failure, not a check.

A missing event does not become a check. The office does not invent a finish.

When a run finishes, its ticker row drops into a persistent list below the ticker. That list stays on screen, scrolls, and does not clear when the ticker moves on. Each row is clickable and opens details for that run only: project, provider, started time, finished time, status, and a link. The link renders only when it is `http:` or `https:` with no userinfo, using `rel="noopener noreferrer"`. Any other scheme, including `javascript:`, is omitted. Opening details does not launch, talk, or spawn.

The visible list resets on a fixed weekly rollover: Monday 00:00 in the office host's local timezone, the zone configured on that machine. The repo does not name a city, an offset, or a zone. A run whose finish time is before that Monday moves into the local archive and leaves the panel. The archive is gitignored `.agent-office/task-feed-archive.jsonl`, mode `0600`, and it is not returned to the panel. Archive rows follow the same 30-day review and prune as other transcripts. The office does not show them after the rollover.

The feed has to hold hundreds or thousands of runs. The panel virtualizes the list (it draws only the rows on screen). The server pages the current week. Filter by project and search run on the server, on the requested page, not by shipping every run to the browser. Memory does not keep an unbounded array of runs.

Status comes only from a real adapter event or an existing bridge event. A row is not synthesized from a clock, a chat line, or a desk card.

Feed files stay local: gitignored `.agent-office/task-feed.json`, mode `0600`, current week only, same retention rules. Run titles and bot text are data. The panel renders them as escaped text. It does not parse them as HTML, does not evaluate them, and does not treat them as a tool call.

No new listener and no new port. The panel reads through the existing office server. The feed is read-only for bots: a bot token cannot post a row, edit a row, or confirm a launch. A feed row never starts a run. A launch still needs the owner session confirm.

## Phased rollout

Each phase is its own draft PR, then a security Crit, then the owner's own Yes. That Yes is not this page, and it is not a relay. A later phase does not start inside an earlier PR. No phase merges on its own from this plan.

**Phase A0. Status contract.** The [Provider status contract](#provider-status-contract) and the shim. Existing seats keep today's chips. No new network, no new chair, no paid call.

**Talk binding, Needs-owner queue, desk surface, honest roster.** Already on the stacked branches: talk and the desk card on #11, the roster chip on #11 (`src/shared/hq.ts:114-127`), and the Needs-owner queue on #9 (`GET /api/bridge/hq-brief`). This step binds those surfaces to the shim. It does not redesign them. The words for a missing provider stay "Needs owner".

**Phase A. Plugin chairs (additive).** New `src/server/providers/seats/` registry, only through the status contract. Resident entries, and guest requests that still need a session confirm. Existing crew desks, Okkin, the bridge, and kavi are not edited. No new outbound network. No paid call, and `probe()` does not make one. `cursor-cloud-agent` and `openai`, if a file exists at all, are skeletons: `probe()` is `not_connected`, and tests assert `fetch` is never called. Task agents are not seated and are not spawned yet. `guestChairCap` is enforced. A file edit does not seat a guest. Acceptance includes: each adapter's status mapping onto the contract; a missing provider is never `working`; `working` only while an in-flight promise is pending and clears on error; `lastEventAt` is not refreshed on read; the registry rejects an unknown provider; an unknown connector or entry key, including a nested one, refuses the whole entry; a string that looks like a key refuses the entry; a plugin `displayName` that fails the say-name fold is not shown; a task run does not create a chair; a guest request past the cap stays hidden; the current honesty tests (offline queued notice, no fake WORKING, no synthesized bot lines), Okkin model switch, bridge auth, rate limits, and 413 still pass without modification.

**Phase B. Project index and task feed.** The [Project index at scale](#project-index-at-scale) and the [Task agent feed](#task-agent-feed). Hidden runs roll up under their project and appear in the feed, not as chairs. `repo` and `links` render only as `http:` or `https:` anchors with `rel="noopener noreferrer"`. Local `claude-cli` may spawn on talk into a hidden run, under the paid spawn rules in Per-provider design (named env allowlist, flat-subscription file), and still with no chair unless a session confirm pinned a guest. No cloud paid call is added in this phase. Storage and retention from Scale direction land here. The floor still draws only residents, seated guests, and no project furniture.

**Morning delta.** The digest already sketched on #9 (`cursor/unblock-queue-digest-016d@8d73331e`, `docs/configuration.md:40`). This plan does not rewrite it. It stays a read of real desk, queue, and board-status lines since the last visit. It does not synthesize a status row.

**Work pool.** Already implemented on #12 (`cursor/community-work-pool-fb60@d376d8cb`, `src/shared/pool.ts:50-58` and `:96-108`). Seven levels, which supersede any open-versus-gated pair. Okkin is capped at level 3. A job with no level defaults to 4. Level 4 and above covers network, shell or commands (`curl`, `ssh`, `rm`), URLs, paths, code, money, sends or messages, accounts, and secrets. Levels 6 and 7 need the security reviewer's pass and then the owner's own Yes, from someone other than the poster or the claimer. Okkin's output is text only and never triggers a send or a run. A pool claim still does not launch a paid run or seat a guest. This page does not carry that Yes.

**Phase C. Paid cloud adapters.** `cursor-cloud-agent` and `openai` may call their fixed hosts only when `AO_PAID_ENABLED=1`, and only after the owner's own Yes on that key. Missing or any other value means every paid adapter is off, even with a key present. That Yes does not set the flag. Each launch is code-tier and money-tier and needs its own session confirm. A pool claim or bot text does not launch. `probe()` stays key presence, or one documented free endpoint that counts against the daily cap. Short-lived runs stay hidden. A guest chair still needs a session confirm and a free slot under the cap. Per-provider and per-project spend caps apply. No automatic retry.

## What this PR does not do

This change is the plan page only. It does not add adapters, routes, seats, keys, listeners, or dependencies. The current foundation stays as it is.
