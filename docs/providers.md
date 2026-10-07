# Providers

Back to the [README](../README.md). The seats that already exist are described in [Local HQ](hq.md).

This page is the plan for review. It does not change the running office. The provider model is **additive, opt-in per seat, no behavior change to existing seats**.

The office is the 1:1 meeting place for every bot the owner runs, across providers, and it has to keep working when those bots cover hundreds or thousands of projects. A seat is one adapter. The adapter reports honest status. The current crew desks, Okkin, the bridge, and kavi keep their behavior. The fixed list of ten seats is replaced by a seat registry (see [Seat registry and per-seat tokens](#seat-registry-and-per-seat-tokens)). The current ten become registry entries with the same ids, desks, chips, and routes. An existing seat may be wrapped in an adapter later, only in a later draft after its own review, and not by this plan's first code.

No new API key, account, or install happens without the owner's own Yes. The sections below are direction. Building each phase still needs that Yes. This page does not carry it, and a relay file does not carry it.

## Current state (audited)

Read-only, at these tips. Nothing here is a behavior change. The facts are generic: public branch names, files in this repo, and line numbers. No host name, machine path, account id, or personal name.

| PR | Branch @ sha |
| --- | --- |
| main | `main@a08bc78` |
| #7 | `forgel/core-hq@5c2ae276` |
| #8 | `cursor/gh-boards-fail-closed-3e5e@15f8f0c0` |
| #9 | `cursor/unblock-queue-digest-016d@8d73331e` |
| #10 | `cursor/huddle-ollama-64e4@559f5d96` |
| #11 | `cursor/hq-crew-okkin-7ab2@cf6500cc` |
| #12 | `cursor/community-work-pool-fb60@d44c4a41` (PR head) |

### Where a seat gets a state

`main@a08bc78` has hired workers only. `WorkerStatus` is `starting`, `idle`, `working`, `needs_input`, `done`, `exited`, `offline` (`src/shared/protocol/workers.ts:6-13`). There is no crew seat, no roster chip, and no `stale`. `lastInput.at` is the last input time when a hook or a person typed (`src/shared/protocol/workers.ts:92` on #11; the field exists on main). A quiet shell goes idle after 12s. Nothing records a per-bot `lastEventAt` that survives a file re-read.

`#7@5c2ae276` adds bridge presence for **shells**. `applyCrewPresence` (`src/server/workers/crew.ts:46-73`) maps a name to `working` or `idle` and skips `needs_input`. A working push sets `lastInput` to `{ by: 'crew-status', at: Date.now() }` (`crew.ts:64`). Re-reading `crew-status.json` (`crew.ts:81-86`) calls that again, so the stored time is the read, not the push. The lease is 15 minutes (`crew.ts:10`), then `tickWorkingLease` (`crew.ts:96-109`) sets `idle`. There is no `stale` and no `offline` chip. `POST /api/bridge/status` accepts `{ name: string, status: "working" | "idle" }` (`src/server/http/routes/bridge.ts:193-208`). `POST /api/bridge/crew-status` accepts `{ crew: Record<string, string> }` and writes `{ updatedAt: string, crew, source: "bridge" }` (`bridge.ts:150-175`). No `seen` map.

`#8@15f8f0c0` does not change `crew.ts`, `bridge.ts`, or `hq.ts` relative to #7.

`#9@8d73331e` adds the morning delta and the unblock queue (`docs/configuration.md:40` and `:53`, `GET /api/bridge/hq-brief`). A bridge token cannot approve. `board-status.json` lines are `done`, `progress`, or `blocked`. That is a digest, not a per-bot `lastEventAt`. `crew.ts` gains a seat map for the digest; it does not add `stale`.

`#10@559f5d96` is the huddle branch (PR #10). `SeatBoard.probedAt` (`src/server/seat-provider.ts:49`, refreshed at `:90-91`) only throttles probes. It is not a per-run event time. Faces are a label string: `offline`, `no provider — needs owner`, `bridge`, or queued (`seat-provider.ts:160-167`). No shared state enum.

`#11@cf6500cc` is the crew-seat code this plan stacks on. `WorkerStatus` adds nothing to the main union; `WorkerKind` adds `crew` (`src/shared/protocol/workers.ts:6-15`). Roster chips are separate: `working`, `blocked`, `idle`, `done`, `stale`, `offline`, `switching` (`src/shared/hq.ts:111`). `rosterChip` (`hq.ts:114-127`) uses `beat.at`. Decay for a `working` beat: under 15 minutes `working` (`WORKING_LEASE_MS`, `hq.ts:16`), from 15 to 30 minutes `idle`, from 30 to 45 minutes `stale` (`STALE_AFTER_MS`, `hq.ts:19`), at 45 minutes `offline` (`OFFLINE_AFTER_MS`, `hq.ts:20`). Any other beat is `stale` at 30 minutes and `offline` at 45. `blocked` never decays. A missing or future `at` is `offline`.

`writeCrewPush` (`src/server/workers/crew.ts:90-102`) stores `seen[seat] = now` on the push and does not refresh it when the file is re-read (`tickCrewStatusFile`, `crew.ts:158-164`). Okkin is not in that file. `applyCrewPresence` (`crew.ts:111-142`) paints crew seats only, never shells. `working` applies only when `seen` is inside the 15-minute lease. `blocked` sets `needs_input` with `lastInput.by = 'crew-status'` and `at` from `seen` (`crew.ts:125-127`). A later push clears that needs-input. A `needs_input` from any other `by` stays. Chat does not set working (`crew.ts:153-156`). The lease timer (`crew.ts:193-203`) drops `working` to `idle` after 15 minutes. It does not itself write `stale` or `offline`; those exist on the roster chip only.

Okkin's chip (`src/server/hq/okkin.ts:8` and `:50-55`) is `offline`, `switching`, `working` (only while a chat is in flight, `depth > 0`), or `idle`. `syncOkkin` (`crew.ts:170-186`) maps `working` and `offline` through, and maps `switching` to idle with an activity string. While the chip is `working` it sets `lastInput.at` to `Date.now()` on that tick (`crew.ts:181`), which is the tick, not the request's start. There is no stored time for the last successful probe.

`#12@d44c4a41` is the work pool. It does not replace seat status. `LEVELS` is seven entries (`src/shared/pool.ts:50-58`). `PoolStatus` is `open`, `claimed`, `needs_approval`, `done` (`pool.ts:36`). Okkin is capped at level 3 (`pool.ts:106`). A job with no level defaults to 4 (`pool.ts:96`), which that cap cannot claim. Keywords only raise the floor (`pool.ts:97`, `src/shared/pool-keywords.ts`). `rm`, a sign-in, or a code filename raises at least to 4. Network, a shell or a command (`curl`, `ssh`), a URL, code, or a secret raises at least to 6. Money, a send or a message, a merge, or a delete raises at least to 7. Above level 3, a claim also needs the crew allowlist (`pool.ts:107`). Levels 6 and 7 must be the named target (`pool.ts:108`). Completing level 6 or level 7 moves the job to needs approval, waiting on the security reviewer's pass (`src/server/pool/pool.ts:204-206`). Both levels need that pass, and then the owner's own Yes. The pass is recorded only by an id on the reviewer allowlist (`pool.ts:227`). The Yes is recorded only by an id on the approver list, and only after the pass (`pool.ts:247`, `:253-254`). The pass and the Yes come from different actors, compared by id, never by display name. The reviewer must not have posted, claimed, or completed the job (`pool.ts:228`, `:412-415`). The approver must not be the id that recorded the pass, and must not have posted, claimed, or completed the job (`pool.ts:255-256`). The pool never runs the action, and Okkin's output is text only and never triggers a send or a run (`pool.ts:191`). Those seven levels are the claim rules. They replace any open-versus-gated two-tier wording. The code does not, by itself, give anyone a Yes.

### Okkin models

No model tag is hardcoded. `qwen3.5:9b` appears once, as a doc example on `#10` (`docs/configuration.md:69`). It is not in `#11` source.

On `#11`, the configured tag is `OKKIN_MODEL`, else `model` in gitignored `ollama.json`, else `hq.okkinModel`, else empty (`src/server/hq/okkin.ts:65-70`, `src/server/ollama.ts:79`). The allowlist is `OKKIN_MODEL_ALLOW`, else `hq.okkinAllow`, split on commas and checked with `modelTagOk` (`okkin.ts:70-74`, `src/shared/hq.ts:279-280`). `modelTagOk` checks length and path characters. It is not a list of tags. The switch list, when the office is running, is that allowlist intersected with names from live `GET /api/tags` (`modelChoices`, `hq.ts:269-276`; applied in `okkin.ts:112`). The allowlist is not a list of installed tags. This audit did not call the host. Installed local model tags stay unverified until a live check on the host.

The desk roster's model switch exists on `#11` (`src/client/features/hq/ui.ts:71-72`, `POST /api/bridge/okkin/model` at `src/server/http/routes/hq.ts:191-204`). `main@a08bc78` has no such route.

### Bridge packets, and what the contract still lacks

`#11` `POST /api/bridge/crew-status` body is `{ crew?: Record<string, string> }` (`src/server/http/routes/bridge.ts:260`). The file and the response add `updatedAt` (ISO string), `seen` (seat id to epoch ms), and `source` (string) (`bridge.ts:275`, `crew.ts:100`). `POST /api/bridge/status` body is `{ name: string, status: "working" | "idle" }` (`bridge.ts:299-304`). Seat id is the key. There is no `provider`, `task`, `projectId`, or `botId`.

`POST /api/bridge/kavi-feed` body is `{ titles?: { name?: string, id?: string, modifiedTime?: string }[] }` (`bridge.ts:325-332`). The file is `{ updatedAt: string, source: "bridge", allowlist: string, titles }` (`bridge.ts:334-338`). `id` is an optional string on a title, not a bot id. There is no state, no `lastEventAt` per bot, no task, and no `projectId`. The outbox items are `{ title, text, at }` plus a note string. That feed cannot fill the status contract below without a shim that leaves those packets as they are and sets the missing fields to empty.

## What stays

These keep their current behavior. The plugin does not edit them, replace their routes, or move them onto the registry:

- Crew desks and the gitignored desk map (`seats` as seat id to desk id).
- Okkin, including the loopback Ollama client in `src/server/ollama.ts`, the model switch, and the rule that WORKING is only a real `/api/chat` in flight.
- Bridge auth, crew-status, inbox, talk limits, and the 16 KB body cap (413). The seat registry step changes only the `account` flag and the seat binding on say, status, and crew-status (see [Seat registry and per-seat tokens](#seat-registry-and-per-seat-tokens)).
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

## Seat registry and per-seat tokens

Direction, needs owner Yes per step. Today the crew is a fixed list of ten seats (`seat-1` … `seat-9` and `okkin`, see [Local HQ](hq.md)). The plan replaces that fixed list with a seat registry.

- The registry is one list of seat records in gitignored local data under `.agent-office/`, mode `0600`. A record holds the seat id, its provider, its tier, its desk binding, and a token hash. The current ten seats become registry entries with the same ids, desks, chips, and routes, and their behavior does not change. `pluginSeats` entries load into the same registry.
- Each seat that acts through the bridge gets its own token. The office stores only a hash of it, shows the token once when it is issued, and can revoke it. A per-seat token speaks only as its own seat id. It cannot act as the player, the owner, or an approver, and it cannot record a pass or a Yes.
- Per-seat hashed tokens are required before any action button goes live. Yes, No, nudge, and pool claim buttons stay off until the registry issues per-seat tokens.
- The shared bridge token stays out of player and approver paths. It cannot write role `player`, record a pass or a Yes, confirm a pin, or confirm a launch.
- `POST /api/bridge/say`. Today a shared-token call stamps `account: true` on the line under whatever `name` the body supplied (`src/server/http/routes/bridge.ts:207-223` on `#11`). That must change. `account: true` is set only when the caller presents a per-seat token, and the name shown is that seat's registry name, not the body's. A call with only the shared token drops the flag and is shown as an unverified bridge line.
- `POST /api/bridge/status` and `POST /api/bridge/crew-status`. Same rule. Today the shared token can write any seat's state by a body-supplied name or map key (`bridge.ts:256` and `:295` on `#11`). With the registry, a push changes only the seat bound to the per-seat token that sent it. A push with only the shared token is tagged `bridge-token` and counts as a self-report. It cannot set `working`, clear `needs-owner`, or override office-observed state.

## Seat tiers

Physical chairs are for persistent assistants. The floor does not grow a chair per run.

| Tier | Who | On the floor |
| --- | --- | --- |
| resident | Long-lived assistants: grok-bot-bridge, kavi-bridge, and the local model via ollama | A chair, opt-in, one entry each |
| guest | A small set of important cloud agents the owner assigns or pins | A spare chair, only while a pin fits under the cap |
| hidden | Short-lived task agents: Cursor cloud agents, Claude Code runs, and any run that was not pinned | No chair. A run or a count under its project on the summary board |

Rules:

1. A resident entry is allowed only for `grok-bot-bridge`, `kavi-bridge`, and `ollama`. Those are the long-lived assistants. Each one still needs its own `pluginSeats` entry. The current Okkin seat and the current crew desks are not that entry.
2. Guest chairs have a capped count. The default cap is 4. `guestChairCap` in gitignored `hq-local.json` may set another positive integer. The repo does not hard-code a list of guests. `hq-local.json` is owner-trusted (any local process on the host could edit it). A line in that file is not by itself a seated guest.
3. A run becomes a guest only by an owner pin, and the pin is a session action in the UI. A `pluginSeats` entry with `"tier": "guest"` is a request. The chair is seated only after an office session confirms that pin. Starting a run does not write a pin. A pool claim, a bot line, and a file edit do not confirm one.
4. When guest chairs are full, a new confirmed pin is kept as waiting and the agent stays a hidden run. It does not take a chair from someone already seated. When a guest chair frees, the office seats a waiting pin only if that pin already has a session confirm. A file line alone is not a confirm. The office does not invent one.
5. Task agents never receive a chair on their own. `claude-cli` and `cursor-cloud-agent` default to hidden. `openai` defaults to hidden. Any of them may sit as a guest only by an owner pin, and only while the cap allows.
6. Hidden runs are absent from the floor, the desk roster, and the walking cast. Their honest status appears as runs or counts on the project summary (step 7). A hidden run is not painted WORKING unless that run is really in flight.

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

- `offline` means the provider was reached for and did not answer (down or refused). A closed office is not `offline`; see [Open and closed](#open-and-closed).
- `not_connected` means the tool or the credential is absent. The reason shown is `not connected — needs owner`.
- `idle` means reachable, with no run in flight.
- `working` means a real run or request is in flight. The chip clears when that promise settles, including when it errors. A missing provider is never WORKING. Chat does not force WORKING. `probe()` never makes a paid call and never starts a run. In the paid-adapter step a paid adapter's `probe()` is key presence only, or one documented free endpoint. That free endpoint still counts against the daily cap and is rate-limited.
- `queued` is a `talk()` result, not a chair and not a WORKING chip. The chip stays the last `probe()` status. The only office line added is the existing office-role notice that the message was queued. The office does not write a bot line.

A reply exists only when the provider returns text. The office does not synthesize a reply or a presence. `runs()` is empty unless a real run id exists. A project is `active` only when such a run exists (see Scale direction).

`needs_input` stays a status of the current crew bridge only. Plugin seats do not gain that chip. A plugin seat that needs the owner is `not_connected` with the reason above. A plugin run that is blocked and no longer in flight is `idle` or `not_connected`, with a reason, and is not WORKING.

Talk that can send as the owner is session-only, same bar as `POST /api/bridge/talk`: an office session, a bridge token refused, one line every 3 seconds, 20 lines a minute, body over 16 KB refused (413). Adapter replies are role `bot`. They are never role `player`.

## Per-provider design

### claude-cli

Default tier: hidden. A Claude Code run does not get a chair unless the owner pins a guest and the cap allows.

Status: `probe()` checks PATH with the same executable check the office already uses (`X_OK` on the resolved command). The command name is fixed as `claude`. The connector has no keys, so it cannot set a path or another command. Missing or not executable: `not_connected`, reason `not connected — needs owner`, `keyPresent: no`. Present: `idle` when nothing is spawned, `working` only while a spawned run is in flight. `probe()` does not spawn and does not make a paid call.

A claude-cli talk spawn is step 7. It is a tool run and it may cost money. It always counts as paid: it needs `AO_PAID_ENABLED=1`, a spend reservation that fits the daily call cap and the token cap (the output byte cap stands in for tokens), and Stop paid off. A PATH hit is not proof of a flat plan. An owner-written flat-subscription file (gitignored `.agent-office/claude-cli-flat-subscription.json`, `{ "flat": true }`) is advisory only. It may change a label on the health tile or in the spend log. It MUST NOT bypass a spend cap, the reservation, Stop paid, or the `AO_PAID_ENABLED=1` gate. The reason: mode `0600` cannot be enforced on Windows, and any local process running as the user could create that file, so its presence proves nothing. The office reads it and does not create it, rewrite it, or log its body. With `AO_PAID_ENABLED` missing or any other value, `talk()` returns `queued` and nothing is spawned.

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

Failure: command missing, `AO_PAID_ENABLED` not exactly `1`, a reservation that does not fit a cap, Stop paid on, spawn error, timeout, output over the cap, or a non-zero exit with no text. Status stays honest. `talk()` returns `queued` when nothing was spawned. No bot line is written.

### cursor-cloud-agent

Default tier: hidden. Design only until the paid-adapter step, which follows the meeting room. A Cursor cloud agent does not get a chair unless the owner pins a guest and the cap allows. Short-lived runs stay hidden.

Status: `probe()` never makes a paid call and never launches an agent. Before the paid-adapter step it returns `not_connected` and does not call the network. In the paid-adapter step, `probe()` is key presence only (`key present: yes` or `no`), or one documented free endpoint. That free endpoint still counts against the daily cap and is rate-limited. `probe()` does not return `working`. A present key with `AO_PAID_ENABLED` missing or not exactly `1` is still `not_connected`, reason paid adapters off.

Launch is the paid-adapter step, and it is code-tier and money-tier. Each launch needs an owner gate: a session confirm for that launch. A pool claim does not launch. Bot text does not launch. The talk text is data and is not the confirm. A launch also requires `AO_PAID_ENABLED=1`. Any other value, including a missing variable, means no call, even when a key is stored.

Network: none before the paid-adapter step. No `fetch`. That step, after the owner's Yes for that key and only while `AO_PAID_ENABLED=1`, uses a fixed host allowlist baked into the adapter (the Cursor API host), `https` only, `redirect: 'error'`, a timeout, and a response byte cap. Paths are constants. The model name goes in the body only. The base URL is not read from config, from the seat, or from the message.

Env: Windows Credential Manager is the place to store the key. A user env var is a fallback only, because a user-scope env var is visible to every process running as that user. The value is never printed. Status shows `key present: yes` or `key present: no`.

Failure: missing key, `AO_PAID_ENABLED` not exactly `1`, cap exceeded, HTTP error, timeout, oversized body, or a launch with no session confirm. Each one is `offline` or `not_connected`. No retry loop. `talk()` without a confirmed launch returns `queued`.

### openai

Default tier: hidden. Design only until the paid-adapter step. Same skeleton rules as `cursor-cloud-agent`. An important long-lived use may be pinned as a guest. A task call is a hidden run.

The only outbound host, in the paid-adapter step, is `api.openai.com`. A user-supplied or "OpenAI-compatible" base URL is rejected. Paths are fixed. The model name goes in the body only. `max_tokens` is capped by a constant in the adapter. `maxTokens` in the connector may lower that cap and MUST NOT raise it.

`probe()` never makes a paid call. Before the paid-adapter step it is `not_connected` and `fetch` is not called. In the paid-adapter step it is key presence only, or one documented free endpoint that still counts against the daily cap and is rate-limited. A call that spends money also requires `AO_PAID_ENABLED=1`. Each such call needs the same owner session confirm as a Cursor launch: not a pool claim, and not bot text.

Env: Windows Credential Manager first. A user env var is a fallback only, because a user-scope env var is visible to every process running as that user. Same `key present: yes/no` rule.

### grok-bot-bridge

Default tier: resident. This is the long-lived assistant path that already uses the authenticated bridge.

A new resident is a new seat id in `pluginSeats`. The adapter reads that id from the existing crew-status file and inbox. It does not rewrite the file format, the bridge routes, or the current seats. A `working` push is a self-report. A self-report alone never shows WORKING. WORKING needs a real heartbeat: a push from that seat's own per-seat token, inside the lease, paired with activity the office observed for that seat (inbox text from it, a live pool claim heartbeat from it, or a hook or terminal event). Without that, a fresh push keeps the seat `idle` at most, and it then decays to stale and offline as today. A push does not stamp "now" onto an old heartbeat. Chat does not force WORKING.

Talk for that new id uses the existing outbox and inbox. A bot line appears only when inbox text arrives for that id. Otherwise `talk()` returns `queued` and the office line is the existing queued notice.

Network: loopback only, the existing bridge host allowlist (`127.0.0.1` on the office ports). No new listener. The shared bridge token is not a per-bot token. Per-seat tokens come from the seat registry: stored hashed, revocable, and unable to act as the player, the owner, or an approver.

Env: none for a provider key. Bridge gate stays as it is.

Failure: no heartbeat is `offline`. A blocked crew-status on a current seat stays the current seat's behavior. The plugin seat does not copy another seat's heartbeat.

### ollama

Default tier: resident. A new local-model seat may opt in. Okkin is not that seat and is not rewired.

Status and talk go through the existing `src/server/ollama.ts` client. No second client. `probe()` uses the existing tags and ps reads and does not mark WORKING. `working` is only while a real `/api/chat` for this seat is in flight. Switching models is not WORKING. Unreachable or a refused URL is `offline`. When the host sleeps, the whole office is closed, which is not `offline`.

Address: `OLLAMA_URL`, else gitignored `ollama.json`, else `http://127.0.0.1:11434`. `http` only, loopback only (`127.0.0.1`, and `::1` as the current client already allows). `localhost` is rewritten to `127.0.0.1`. Any other host is refused. Redirects are not followed. Response cap about 1 MB. Timeouts stay the current probe and chat timeouts. Allowed paths stay `/api/tags`, `/api/ps`, `/api/chat`, and `/api/generate`. The model name stays in the JSON body.

Env: `OLLAMA_URL`, `OKKIN_MODEL`, `OKKIN_MODEL_ALLOW`. The connector may name a model tag. The tag still has to sit in the allowlist intersected with installed tags. The connector cannot set the URL. A URL on a request is ignored.

Failure: the current Okkin failures (offline, no allowed model, 409 while a request is in flight). No pull, delete, create, copy, push, or raw proxy.

### kavi-bridge

Default tier: resident. Read-only status. The Drive workaround is unchanged.

Status comes from the existing local feed file the bridge already writes. The office does not call Drive. There is no Drive token on the host. Missing feed is `not_connected` or `offline`, not a synthesized presence.

Talk, when the owner uses it, writes to the existing bridge folder (the existing kavi outbox). A coordinator bot relays that folder to Drive. The office does not open a Drive session, and it does not add a listener.

Async label. This channel is asynchronous. Talk goes to a file folder that a coordinator relays to Drive, and replies come back the same way. It is not live. The talk window and the seat chip say so in plain words, for example "async, replies can take a while". The label stays until a faster channel exists and passes its own review. A sent message shows as sent and waiting, not as a reply. A slow reply is not `offline`.

Env: none. Network from this adapter: none.

Failure: unreadable feed is `offline`. The adapter does not invent titles or a bot line.

## Adapter table

| provider | status source | talk path | outbound hosts | key source | paid? | default state | default tier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude-cli | PATH `X_OK` on `claude`; no spawn on probe | step 7 `execFile` on talk; queued if it cannot start | none | none (child env is only `PATH` and `CLAUDE_CONFIG_DIR`) | yes, always (the flat-subscription file is advisory only) | `not_connected` until the CLI is on PATH; off unless `AO_PAID_ENABLED=1` | hidden |
| cursor-cloud-agent | key presence, or one documented free endpoint in the paid-adapter step; no paid probe | queued until a session-confirmed launch | Cursor API host, https, paid-adapter step only; none before that | Windows Credential Manager; user env var is fallback only | yes | off unless `AO_PAID_ENABLED=1` | hidden |
| openai | key presence, or one documented free endpoint in the paid-adapter step; no paid probe | queued until a session-confirmed call | `api.openai.com` only, paid-adapter step; none before that | Windows Credential Manager; user env var is fallback only | yes | off unless `AO_PAID_ENABLED=1` | hidden |
| grok-bot-bridge | real heartbeat for that seat id (per-seat token plus observed activity); a self-report alone is never WORKING | existing outbox and inbox | loopback `127.0.0.1` bridge only | none (shared bridge token is not a bot token) | no | `offline` until a real heartbeat | resident |
| ollama | existing loopback tags and ps probe | existing `/api/chat` | loopback `http` on `127.0.0.1` (and `::1` as today) | none | no | `offline` if unreachable | resident |
| kavi-bridge | existing local feed file, read-only | existing bridge-folder outbox; a coordinator relays; labeled async | none from the office | none on the host | no | `offline` or `not_connected` from the file | resident |

Paid rows stay off unless `AO_PAID_ENABLED` is exactly `1`. Missing or any other value means every paid adapter is off, even with a key present. Stop paid halts them all at once (Security requirements, item 3). `key present` is `yes` or `no` and is not a fragment of the key. Hidden is the default tier for task providers even if someone later pays for a call.

## Security requirements

These are normative. Later steps MUST meet them. A review that finds a break sends that step back.

1. **Keys.** MUST NOT create a key or an account without the owner's own Yes. Provider keys live only on the host. Prefer Windows Credential Manager. A user env var is a fallback only, because a user-scope env var is visible to every process running as that user. Keys MUST NOT be written to the repo, `workers.json`, `hq-local.json`, any `.agent-office` file, the client, the websocket, logs, chat, or transcripts. The server uses a key only to build an outbound call. Status shows `key present: yes` or `key present: no` and never a prefix or a suffix.
2. **Outbound.** Each adapter has a fixed host allowlist. Cloud calls are `https` only, with `redirect: 'error'`, a timeout, and a response byte cap (Content-Length checked before the body is read, same bar as `src/server/ollama.ts`). Endpoint paths are fixed constants. The model name goes only in the body. Cloud adapters MUST NOT accept a base URL from the user, from config, or from the message. Local ollama stays loopback `http` as it is today.
3. **Money.** Paid calls happen only when `AO_PAID_ENABLED=1`. Missing, empty, or any other value means every paid adapter is off, even when a key is present. Okkin and ollama stay the only free default path and do not read this flag. `claude-cli` on talk is always paid. The flat-subscription file is advisory only and MUST NOT bypass a cap, the reservation, Stop paid, or this flag, because mode `0600` cannot be enforced on Windows and any local process could create the file. Each paid call has a `max_tokens` ceiling (a local CLI run uses its output byte cap the same way). Each paid provider has a daily call cap and a daily token cap. Caps are constants; config may lower them and MUST NOT raise them. Spend is logged locally, mode `0600`, as provider, project, seat, time, and counts. The log MUST NOT contain the prompt, the key, or the message. No automatic retry loop. `probe()` MUST NOT make a paid call.
   - **Reserve before call.** Before a paid call, the office reserves that call's worst case (one call, plus its `max_tokens` or output byte cap) against the daily call cap, the daily token cap, and the per-project cap, in one local step. If the reservation does not fit, the call does not start. After the call, the reservation settles to the real counts the provider returned, or stays at the reserved worst case when the provider returns none. On a failure, a timeout, or a call that never started, the unused part is released. Each in-flight call holds its own reservation, so two calls cannot both fit under the same remaining cap. A crash leaves the reservation counted until the daily counter rolls over. It is never released early.
   - **Stop paid.** A live Stop paid control in the office UI halts paid calls immediately. No new reservation is granted, in-flight paid calls are aborted (the request is aborted, a spawned CLI is killed), and their reservations settle to what was spent or are released when nothing was. It takes effect without a restart and without editing `AO_PAID_ENABLED`. It stays on across a restart. Any office session can turn it on. Only the owner's session turns it off. A bot token, a pool claim, bot text, and a file edit cannot turn it off.
4. **Inbound.** MUST NOT open a tunnel, bind a public port, or add a listener. A cloud bot reaches the office only through the existing bridge folder, or by the office pulling outbound. A bot token is per seat, from the seat registry, stored hashed, revocable, and MUST NOT act as the player or the owner or approve anything. Action buttons stay off until those tokens exist. The shared bridge token MUST NOT be used as that token, MUST NOT reach a player or approver path, and MUST NOT stamp `account: true` on `/api/bridge/say` from a body-supplied name. The same binding applies to `/api/bridge/status` and `/api/bridge/crew-status`. Anything that speaks as the owner stays session-only.
5. **Seats.** Honest status only (`offline`, `not_connected`, `queued`, `idle`, `working`), taken from real adapter state. The shared contract in Provider status contract adds `needs-owner` and `stale` as the one shape every provider reports. The words shown are "Needs owner". Chairs follow Seat tiers. Adapter replies are always role `bot`, never `player`. Bot text is data: chat MUST NOT trigger a tool run, a file write, or a send. Claim rules are the seven work-pool levels on PR #12 (`src/shared/pool.ts:50-58` at `d44c4a41`), per project. They replace any open-versus-gated pair. Okkin is capped at level 3 (`pool.ts:106`). A missing level defaults to 4 (`pool.ts:96`). Keywords only raise that floor. Completing level 6 or level 7 waits on the security reviewer's pass and then the owner's own Yes (`src/server/pool/pool.ts:204-206`, `:220-256`). Both levels need both steps. The pass and the Yes come from different actors, compared by id. Neither may be the poster, the claimer, or the completer, and the Yes cannot be the id that recorded the pass (`pool.ts:228`, `:255-256`). This page does not supply either. The pool never runs the action, and Okkin's output is text only and never triggers a send or a run (`pool.ts:191`). An adapter is a claimer. It MUST NOT pass or approve its own job, or raise its own level.
6. **Privacy.** The only text sent to a cloud provider is the message the owner typed to that seat. Prior turns are not attached unless a later review says so. Other seats' threads and the outbox are never auto-forwarded. The owner's protected personal folder is excluded: an adapter MUST NOT read or send any file from that folder, and the folder is not named in the repo, in config samples, or in logs. Transcripts stay mode `0600` under `.agent-office/`, and are reviewed and pruned at 30 days.
7. **Public repo.** Generic seat ids and provider names only. MUST NOT commit account ids, emails, org ids, personal names, Drive ids, machine paths, or tokens. Docs and commit messages use "owner" and "needs owner".
8. **kavi-bridge.** The office writes to the existing bridge folder. A coordinator bot relays to Drive. MUST NOT put a Drive token on the host, and MUST NOT add a Drive client.

Rate limits from Local HQ still apply (talk spacing, 20 lines a minute, 413 over 16 KB). Paid caps sit on top of those limits. A failed call does not retry itself.

## Scale direction

The office is not built around one project. It has to scale to hundreds or thousands of projects, managed through it by many bots across providers. The floor stays small. The summary carries the scale.

### Floors

The building code allows up to 16 floors (`MAX_FLOORS = 16`, `src/shared/floors.ts:7`, refused past that at `src/server/building.ts:288`, on main). This plan does not change that limit. A cap of 6 open floors is a proposal only, and needs owner. Until such a cap is built and approved, the honest limit is 16.

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

The office shows a summary: counts by status, Needs owner items, and active runs, with filter and search. It does not draw 1000 desks. Rooms and chairs show the active subset only: residents, seated guests, and hidden runs that are actually in flight, capped to what the summary page asked for.

Status is pulled on demand (when the summary is opened) or by an event the process already has (a finished promise, or the existing crew-status file read). MUST NOT start a polling loop per project. A summary open reads the local index. It does not fan out a probe to every project. Probes of cloud adapters obey that adapter's rate limit and daily cap. Hidden runs contribute counts. They do not contribute chairs.

### Work pool and spend

The seven work-pool levels apply per project (PR #12 at `d44c4a41`, `src/shared/pool.ts:50-58` and `:96-108`). Okkin stops at level 3. A job with no level defaults to 4. Keywords only raise that floor: `rm`, a sign-in, or a code filename to at least 4; network, shell or commands (`curl`, `ssh`), a URL, code, or a secret to at least 6; money, a send or a message, a merge, or a delete to at least 7. Completing level 6 or level 7 waits on the security reviewer's pass and then the owner's own Yes. Both levels need both steps. The pass and the Yes come from different actors, compared by id. Neither is the poster, the claimer, or the completer, and the Yes is not the id that recorded the pass. The pool never runs the action, and Okkin's output is text only and never triggers a send or a run. A two-tier open-or-gated split is not the rule. Citing the pool is not a Yes.

Spend caps apply per provider and also per project. Each paid call reserves against both before it starts, settles after, and releases on failure (Security requirements, item 3). Either cap stops the next paid call. Stop paid stops all of them at once. Paid calls still require `AO_PAID_ENABLED=1`; any other value stops all of them, even when a key is present. Ollama is unchanged and is not metered as a paid provider. A pool claim is not an owner gate for a paid launch.

### Storage

Records live in append-only files or a light local store under `.agent-office/`, mode `0600`, gitignored. The index is paginated. Memory holds the page being shown, not every project. MUST NOT keep an unbounded in-memory array of projects, runs, or transcripts.

Retention: transcripts and the spend log are reviewed and pruned at 30 days. Daily cap counters may keep one total per provider and per project for the current day, without the message text. A pruned record drops out of the index. Hidden-run rows follow the same 30-day rule once the run is finished.

### Honest status at every level

A seat is WORKING only while its adapter has a run in flight. A project is `active` only while a real run exists. A count on the summary is the number of those real states. Empty, unknown, and not-yet-loaded are not shown as active or WORKING.

## Provider status contract

Step 3 of the proposed order, with mandatory stale. The watchdog and the health tile come first. It is direction until the owner's own Yes. This file is the only status contract. There is no second contract document. Every provider reports one shape. New providers plug in only through it. Existing seats adopt it by a shim that maps the fields in Current state and does not change their leases or who may post. The one chip change is the self-report rule below.

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

`task` is a short title only. It is shown to signed-in seats only, and never to a bot token. `projectId` has the same limit. Neither field is a body, a key, a file path, or a personal detail.

`lastEventAt` comes only from a real adapter, hook, terminal, or bridge event. A clock, a timer, a file re-read, and a self-report with no such event MUST NOT write it. A bridge push is a self-report. It may show a seat as reachable (`idle`). It never shows `working` by itself. The #7 read path stamps `Date.now()` (`src/server/workers/crew.ts:64`). The shim does not copy that stamp.

Decay never promotes a state. A timer can move `working` or `idle` only toward `stale`, and `stale` only toward `offline`. It cannot move `stale` or `offline` back up, and it cannot move `needs-owner`. Today's chips still use 15 minutes to leave `working` (`WORKING_LEASE_MS`) and 45 minutes to reach `offline` (`OFFLINE_AFTER_MS`). The host-reality proposal, step 3, is a tighter grey: no real event for 10 minutes goes grey, whatever the row claims. That step is not decided. Until the owner's own Yes, the shim keeps today's lease times. A self-report alone never shows `working`. Today's `#11` chip still paints a fresh crew push as WORKING (Current state). That is the gap this step closes. Once it is built, the chip on screen follows this contract. `working` needs a real adapter, hook, or terminal event that is still in flight. The words shown for `needs-owner` are "Needs owner".

Closing the office is not an event and not a fault. While it is closed, no row is written and no alert fires. After it opens again, a row with no real event since the close decays by the usual rules, because nothing new is known, but no alert or banner is raised for the closed span. See [Open and closed](#open-and-closed).

Each status carries the source that wrote it: `bridge-token`, `office-session`, `adapter-run`, `ollama-probe`, `hook`, or `file-replay`. A row from the shared bridge token is tagged `bridge-token`. That tag cannot override office-observed state, which is an `office-session`, an `adapter-run`, a `hook`, or a terminal event. It cannot replace that state, clear it, or move it to `working`. It also cannot resolve `needs-owner` or mark an office-launched run done. The audit records what today's `applyCrewPresence` still does. This contract does not keep that as a second rule.

### Mapping from the audit

The shim projects today's fields into `ProviderStatus` and leaves the current chip on screen.

| Today | Where | lastEventAt | Contract state |
| --- | --- | --- | --- |
| `working` and `seen` under 15 min | `#11` `hq.ts:120-121`, `crew.ts:131-136` | `seen[seat]` from the push (`crew.ts:98`) | `working` only with a real heartbeat (per-seat token plus observed activity); a self-report push alone is `idle` |
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

`task` and `projectId` are a short title only, or empty, or null. They are never a body, a key, a file path, or a personal detail. They are shown to signed-in seats only, and never to a bot token. The shim copies a desk-card title or a worker task name only after that cut. `provider` is `grok-bot-bridge` for a crew seat, `ollama` for Okkin, `kavi-bridge` only when a later packet actually names that bot, and the worker's own provider id for a hired agent.

## Project index at scale

Step 7 of the proposed order, with the task agent feed. Hundreds or thousands of projects are a searchable index, not rooms.

An index row is `{ projectId, name, ownerBot, state, lastActivity, needsOwner }`. `projectId` and `name` are short titles only, never a body, a key, a file path, or a personal detail. `ownerBot` is a bot id. `state` is a `ProviderState` from the status contract, or `inactive` when no real run exists. `lastActivity` is the latest real `lastEventAt` among the project's bots and runs. It is null when none exists. It is never a clock read or the time the index was opened. `needsOwner` is true when any of those states is `needs-owner`. The words shown are "Needs owner".

The index is gitignored local data only, under `.agent-office/`, mode `0600`. It is paginated. Search runs on the server, on the requested page. Filters are bot, state, and needs-owner, applied the same way. The browser does not receive every project. Memory does not hold an unbounded array. The repo contains no project list. Source MUST NOT contain a hard-coded array of projects.

The floor draws persistent bots only (residents, and guests that already have a session confirm). Projects are not desks, chairs, or other furniture. They appear in this index, on the boards, and in the coordinator console. Task agents do not get chairs. They roll up under their project and show in the task agent feed.

Finished rows follow the same 30-day review. No new listener. Bots cannot post index rows. A bot token cannot read the index. A row does not launch a run.

## Task agent feed

Step 7, with the project index. Hidden task agents get no chair. Cursor cloud agent runs, Claude Code runs, and any other hidden run show in this panel instead of on the floor.

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

## Acceptance tests

Each step that builds one of these surfaces adds these as tests in `tests/` and passes them. A test that needs a provider uses a local fake, never a paid call.

Talk:

1. A message to a seat whose provider returns text adds exactly one line, role `bot`, for that seat id, with that text.
2. A message to a seat whose provider is missing or offline returns `queued`. The only new line is the office queued notice. No bot line is written, and the chip is not WORKING.
3. A provider error or timeout clears `working` when the call settles. No bot line is written. The talk window shows an honest no-reply state (queued, or no reply with the reason).
4. A message to an async seat (kavi-bridge) shows as sent and waiting, with the async label. No bot line appears until inbox text arrives for that seat. Then exactly one bot line appears.
5. Talk with a bridge token is refused (403). A body over 16 KB is refused (413). The spacing and per-minute limits hold.

Desk:

1. A `working` push alone, with the shared bridge token or with no observed activity, does not show WORKING on the desk or in the contract row.
2. A real in-flight run (a pending adapter call, a hook, or terminal output) shows WORKING. It clears when the call settles, including on error.
3. Re-reading `crew-status.json`, a timer tick, or a chat line does not change `lastEventAt` and does not set WORKING.
4. With no real event, the desk decays toward `stale` and `offline` and never moves back up on its own.
5. Closing the office and opening it again does not show any seat as WORKING from before the close, and raises no alert for the closed span.

Meeting decision log (when the meeting room is built):

1. Recording a decision writes a row with a short title, who (a seat id or account id, not a display name), and when (the real time it was recorded).
2. The rows live in gitignored local data under `.agent-office/`, mode `0600`, append-only. An edit is a new row. The old row stays.
3. After a restart, the log shows the same rows, with the same who, when, and order.
4. A bot token cannot write a row as the owner. A decision row is not a Yes, and it does not launch, approve, or send anything.

## Phased rollout

Each step is its own draft PR, then a security Crit, then the owner's own Yes. That Yes is not this page, and it is not a relay. A later step does not start inside an earlier PR. No step merges on its own from this plan. This is the same order as [Host reality: open while the owner runs it](#host-reality-open-while-the-owner-runs-it-proposal-needs-owner-yes). Both are a proposal until that Yes.

1. **Watchdog autostart.** The watchdog restarts the office after a crash while the owner has it open. It does not reopen an office the owner closed, and it has no schedule. No new listener.
2. **Health tile and dependency banners.** Present/absent and yes/no only: office up, watchdog restarted, `gh` authed, `claude` present, Ollama up, VRAM free. Banners say "gh not signed in" and "claude CLI missing", instead of empty boards or dead seats. No version, path, account name, token prefix, or hostname.
3. **Mandatory stale and the status contract (P0-A).** The [Provider status contract](#provider-status-contract) and the shim. Only a real adapter, hook, or terminal event counts. No real event for 10 minutes goes grey, whatever the row claims. A self-report alone never shows `working`. Decay never promotes a state. Until this step is built, existing seats keep today's chips, including the known gap that a fresh crew push paints WORKING. This step closes that gap. No new network, no new chair, no paid call.
4. **Core surfaces.** Talk binding, the Needs owner queue, the desk surface, and the roster. Already on the stacked branches: talk and the desk card on #11, the roster chip on #11 (`src/shared/hq.ts:114-127`), and the Needs owner queue on #9 (`GET /api/bridge/hq-brief`). This step binds those surfaces to the shim. It does not redesign them. The words for a missing provider stay "Needs owner". The morning delta already sketched on #9 (`cursor/unblock-queue-digest-016d@8d73331e`, `docs/configuration.md:40`) stays a read of real desk, queue, and board-status lines. It does not synthesize a status row. Auth order before any action button goes live: a required `AGENT_OFFICE_PASSWORD` with no default, then verified sender attribution (PR #11), then the seat registry with hashed, revocable, per-seat tokens and the say, status, and crew-status binding. Only then do the Needs owner action buttons (PR #9) go live.
5. **Gap-bridge snapshot (option).** For reading state while the office is closed. It needs a security PASS plus the owner's Yes. Counts and states only. It writes only through the local cloud-sync folder, with no token, API client, or SDK. The office never reads it back. It never goes into a protected owner folder. It comes before any tunnel.
6. **Production mode and local backups.** The built bundle served by one process under the watchdog, plus a local backup on a clean close and at least once a day while the office is open. Backups stay local, mode `0600`, gitignored, with a 30-day prune. A cloud backup of chat or transcripts needs the owner's Yes.
7. **Project index (P0-B).** The [Project index at scale](#project-index-at-scale) and the [Task agent feed](#task-agent-feed). Gitignored local data only, paginated, with server-side search, and no project list in the repo. Hidden runs roll up under their project and appear in the feed, not as chairs. `repo` and `links` render only as `http:` or `https:` anchors with `rel="noopener noreferrer"`. Local `claude-cli` may spawn on talk into a hidden run, under the paid spawn rules in Per-provider design (named env allowlist, `AO_PAID_ENABLED=1`, caps, reserve before call, Stop paid; the flat-subscription file is advisory only), and still with no chair unless a session confirm pinned a guest. No cloud paid call is added in this step. Storage and retention from Scale direction land here. The floor still draws only residents, seated guests, and no project furniture.
8. **Resource-gated pool.** One local model loaded at a time. Check what is loaded before a claim. Pause when GPU use on the host is over about 70%, or when another heavy GPU app is running. The board shows why jobs are queued. This queue adds no network listener and no port. It reads what is loaded through the existing loopback Ollama client and reads GPU use locally on the host. The seven levels already on #12 stay (`cursor/community-work-pool-fb60@d44c4a41`, `src/shared/pool.ts:50-58` and `:96-108`, `src/server/pool/pool.ts:191-256`). They supersede any open-versus-gated pair. Okkin is capped at level 3. A job with no level defaults to 4. Keywords only raise that floor, to 4, 6, or 7 as in Current state. Completing level 6 or level 7 waits on the security reviewer's pass and then the owner's own Yes. Both levels need both steps. The pass and the Yes come from different actors, compared by id. Neither is the poster, the claimer, or the completer, and the Yes is not the id that recorded the pass. The pool never runs the action, and Okkin's output is text only and never triggers a send or a run. A pool claim still does not launch a paid run or seat a guest. This page does not carry that Yes.

Then the meeting room, and the rest.

**Plugin chairs (additive),** after the list above. New `src/server/providers/seats/` registry, only through the status contract. Resident entries, and guest requests that still need a session confirm. Existing crew desks, Okkin, the bridge, and kavi are not edited. No new outbound network. No paid call, and `probe()` does not make one. `cursor-cloud-agent` and `openai`, if a file exists at all, are skeletons: `probe()` is `not_connected`, and tests assert `fetch` is never called. Task agents are not seated and are not spawned yet. `guestChairCap` is enforced. A file edit does not seat a guest. Acceptance includes: each adapter's status mapping onto the contract; a missing provider is never `working`; `working` only while an in-flight promise is pending and clears on error; `lastEventAt` is not refreshed on read; the registry rejects an unknown provider; an unknown connector or entry key, including a nested one, refuses the whole entry; a string that looks like a key refuses the entry; a plugin `displayName` that fails the say-name fold is not shown; a task run does not create a chair; a guest request past the cap stays hidden; the current honesty tests (offline queued notice, no fake WORKING, no synthesized bot lines), Okkin model switch, bridge auth, rate limits, and 413 still pass without modification.

**Paid cloud adapters,** after plugin chairs. `cursor-cloud-agent` and `openai` may call their fixed hosts only when `AO_PAID_ENABLED=1`, and only after the owner's own Yes on that key. Missing or any other value means every paid adapter is off, even with a key present. That Yes does not set the flag. Each launch is code-tier and money-tier and needs its own session confirm. A pool claim or bot text does not launch. `probe()` stays key presence, or one documented free endpoint that counts against the daily cap. Short-lived runs stay hidden. A guest chair still needs a session confirm and a free slot under the cap. Per-provider and per-project spend caps apply. Each call reserves before it starts, settles after, and releases on failure. Stop paid halts every paid call at once. No automatic retry.

## Open and closed

The owner's rule. It applies now and is not part of the proposal below. The office has no set closing time. It is open while the owner runs it, and bots may work any hour while it is open. It closes only when the owner closes it, by a manual shutdown or by the host sleeping. There is no schedule, no timer, and no auto-close.

When it is closed, the UI shows "Closed since <time>", where the time is the real time it closed: the time the office recorded on a manual shutdown, or the last real event before the host slept. Closed is a normal state, not an Offline alarm. It raises no alert, no banner, and no Needs owner item. Seat chips are not marked `offline` because the office was closed.

## Host reality: open while the owner runs it (PROPOSAL, needs owner Yes)

This section is a proposal. It is not decided. Building any step still needs the owner's own Yes. This page does not carry that Yes, and a relay does not carry it. [Phased rollout](#phased-rollout) uses this same order.

Flaws, as they stand:

- One host. While the office is closed, nothing on it can be read from a phone or a second computer.
- No remote access yet.
- A self-reported presence can look like `working` with no real activity.
- The dev server is the runtime, and office data has no backup.
- The local model shares one GPU with other apps on the host.
- A shared office password, plus loopback tokens, means any local process can act as a session.
- Missing dependencies render as empty UI. `gh` not signed in, and the `claude` CLI missing, are the two named here.

Proposed order. This is a proposal, not a decision.

1. Watchdog autostart.
2. Health tile and dependency banners. The tile shows present/absent and yes/no only: office up, watchdog restarted, `gh` authed, `claude` present, Ollama up, VRAM free. Banners say "gh not signed in" and "claude CLI missing", instead of empty boards or dead seats. No version, path, account name, token prefix, or hostname.
3. Mandatory stale, together with the Provider status contract (P0-A). Only a real adapter, hook, or terminal event counts. No real event for 10 minutes goes grey, whatever the row claims. A self-report alone never shows `working`. Decay never promotes a state. `lastEventAt` still comes only from a real event.
4. Core surfaces: talk binding, the Needs owner queue, the desk surface, and the roster. A required `AGENT_OFFICE_PASSWORD` with no default, verified sender attribution, and per-seat hashed tokens from the seat registry all land before the Needs owner action buttons (PR #9) go live.
5. Snapshot as a gap bridge for reading state while the office is closed. An option, not a decision. Security PASS plus the owner's Yes. Every condition below stays. It comes before any tunnel.
6. Production mode: the built bundle served by one process under the watchdog, plus a local backup of office data on a clean close and at least once a day while it is open. That backup stays local.
7. Project index (P0-B). Gitignored local data only, paginated, with server-side search, and no project list in the repo.
8. Resource-gated pool. One local model loaded at a time. Check what is loaded before a claim. Pause when GPU use on the host is over about 70%, or when another heavy GPU app is running. The board shows why jobs are queued. No new listener and no port. Okkin's level 3 cap and text-only output stay, as in the pool code on `#12`.

Then the meeting room, and the rest.

Security conditions. These are part of the proposal. This page does not carry a security PASS or the owner's Yes, and a relay does not either.

1. **Offline snapshot.** The gap-bridge option below needs a security PASS plus the owner's Yes before it is built.
2. **Tunnel or remote access.** Any tunnel or remote-access path needs a security PASS plus the owner's Yes. The read-only snapshot comes before any tunnel.
3. **Backups.** Backups stay local, mode `0600`, gitignored, with a 30-day prune. A cloud backup of chat or transcripts needs the owner's Yes.
4. **Auth order.** Before any action button goes live: a required `AGENT_OFFICE_PASSWORD` with no default, then verified sender attribution (PR #11), then the seat registry with hashed, revocable, per-seat tokens and the say, status, and crew-status binding. Only then do the Needs owner action buttons (PR #9) go live. Yes, No, nudge, and pool claims stay off until the password is required and per-seat tokens exist.
5. **Health tile.** Present/absent and yes/no only. No versions, paths, account names, token prefixes, or hostnames.

### Gap-bridge snapshot (option)

The snapshot is an option, not a decision. It is a gap bridge for reading state while the office is closed. It needs a security PASS plus the owner's Yes. This page does not carry either.

It writes only through the local cloud-sync folder. It uses no token, no API client, and no SDK. It holds counts and states only. No titles when counts suffice. Never bodies, paths, or keys. The office never reads the file back. The file never goes into any protected owner folder. A phone or a second computer could read it while the office is closed. That read is not acting.

Reusing the existing bridge folder is not this snapshot, and this option does not add a second write surface inside a protected folder. Acting from the phone, and any tunnel, still need a security PASS plus the owner's Yes, and they come after this read-only snapshot.

## What this PR does not do

This change is the plan page only. It does not add adapters, routes, seats, keys, listeners, or dependencies. The current foundation stays as it is.
