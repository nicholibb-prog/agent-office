# Providers

Back to the [README](../README.md). The seats that already exist are described in [Local HQ](hq.md).

This page is the plan for review. It does not change the running office. The provider model is **additive, opt-in per seat, zero change to existing seats**.

The office is the 1:1 meeting place for every bot the owner runs, across providers, and it has to keep working when those bots cover hundreds or thousands of projects. A seat is one adapter. The adapter reports honest status. The current crew desks, Okkin, the bridge, and kavi stay byte-for-byte as they are. Nothing in the current ten seats is migrated. An existing seat may be wrapped later, only in a later draft after its own review, and not by this plan's first code.

No new API key, account, or install happens without the owner's approval.

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

`displayName` on a public checkout is the seat id. A local name may live in gitignored config. `connector` holds things like a model tag or `{ "enabled": false }`. It does not hold a key, a token, a password, or a base URL.

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
2. Guest chairs have a capped count. The default cap is 4. `guestChairCap` in gitignored `hq-local.json` may set another positive integer. The repo does not hard-code a list of guests.
3. A run becomes a guest only when the owner pins it (a `pluginSeats` entry with `"tier": "guest"` for that seat). Starting a run does not write a pin.
4. When guest chairs are full, a new pin is kept as waiting and the agent stays a hidden run. It does not take a chair from someone already seated. When a guest chair frees, the office seats a waiting pin only if the owner left that pin in place. It does not invent one.
5. Task agents never receive a chair on their own. `claude-cli` and `cursor-cloud-agent` default to hidden. `openai` defaults to hidden. Any of them may sit as a guest only by an owner pin, and only while the cap allows.
6. Hidden runs are absent from the floor, the desk roster, and the walking cast. Their honest status appears as runs or counts on the project summary (phase B). A hidden run is not painted WORKING unless that run is really in flight.

`tier` omitted means the provider default in the table below. An entry that asks for `resident` on a task provider is refused and stays hidden. An entry that asks for a chair on an unknown provider is refused.

## How to plug in a new bot

Three steps, for a resident or for an owner pin. Task agents skip this. They do not get a chair.

1. Add one object to `pluginSeats` in gitignored `.agent-office/hq-local.json` (next to that floor's `workers.json`). Leave the existing `seats` desk map as it is.
2. Restart the office. The registry loads that list and no other seat list.
3. A resident, or a guest pin that fits under the cap, shows its provider and an honest chip (`not connected — needs owner`, offline, idle, or working). Anything else stays a hidden run.

```json
{
  "pluginSeats": [
    { "id": "seat-10", "provider": "ollama", "tier": "resident" }
  ],
  "guestChairCap": 4
}
```

A guest pin uses `"tier": "guest"` and a provider id. A connector, when present, has no secrets. A local `displayName` is optional and stays in this file. A field named `apiKey`, `api_key`, `token`, `secret`, `password`, `authorization`, or `bearer` causes the entry to be skipped. The value is not logged, not sent to the client, and not stored again. The chip is `not_connected`.

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
- `working` means a real run or request is in flight. The chip clears when that promise settles, including when it errors. A missing provider is never WORKING. Chat does not force WORKING.
- `queued` is a `talk()` result, not a chair and not a WORKING chip. The chip stays the last `probe()` status. The only office line added is the existing office-role notice that the message was queued. The office does not write a bot line.

A reply exists only when the provider returns text. The office does not synthesize a reply or a presence. `runs()` is empty unless a real run id exists. A project is `active` only when such a run exists (see Scale direction).

`needs_input` stays a status of the current crew bridge only. Plugin seats do not gain that chip. A plugin seat that needs the owner is `not_connected` with the reason above. A plugin run that is blocked and no longer in flight is `idle` or `not_connected`, with a reason, and is not WORKING.

Talk that can send as the owner is session-only, same bar as `POST /api/bridge/talk`: an office session, a bridge token refused, one line every 3 seconds, 20 lines a minute, body over 16 KB refused (413). Adapter replies are role `bot`. They are never role `player`.

## Per-provider design

### claude-cli

Default tier: hidden. A Claude Code run does not get a chair unless the owner pins a guest and the cap allows.

Status: `probe()` checks PATH with the same executable check the office already uses (`X_OK` on the resolved command). The command name is `claude`. A connector may repeat that bare name. It may not set a filesystem path. Missing or not executable: `not_connected`, reason `not connected — needs owner`, `keyPresent: no`. Present: `idle` when nothing is spawned, `working` only while a spawned run is in flight. `probe()` does not spawn.

Talk: spawn only on `talk()`, and only for a hidden run or a pinned guest. No spawn on a timer. The child gets no copy of provider keys from the office environment. When the process exits, status leaves `working`. Failure to spawn is `offline` or `not_connected`, and `talk()` returns `queued`. There is no synthesized assistant line.

Network: none. This adapter does not open a socket.

Env: PATH only. No API key.

Failure: command missing, spawn error, or a non-zero exit with no text. All of those leave the seat or the run honest, and none of them write a bot line.

### cursor-cloud-agent

Default tier: hidden. Design only until phase C. A Cursor cloud agent does not get a chair unless the owner pins a guest and the cap allows. Short-lived runs stay hidden.

Status: `probe()` returns `not_connected` and `keyPresent: no` while the owner has not approved a key. If a local flag `connector.enabled === true` and the env var are both present, `probe()` still returns `not_connected` with reason `adapter not enabled in this build` until phase C. It never returns `working` in an earlier phase.

Talk: `queued`. No outbound call.

Network: none in phase A or B. No `fetch`. Phase C, after the owner's Yes for that key, uses a fixed host allowlist baked into the adapter (the Cursor API host), `https` only, `redirect: 'error'`, a timeout, and a response byte cap. Paths are constants. The model name goes in the body only. The base URL is not read from config, from the seat, or from the message.

Env: one user env var, or the OS credential store. The name of the var is fixed in the adapter. The value is never printed. Status shows `key present: yes` or `key present: no`.

Failure: missing key, kill switch off, cap exceeded, HTTP error, timeout, oversized body. Each one is `offline` or `not_connected`. No retry loop.

### openai

Default tier: hidden. Design only until phase C. Same skeleton rules as `cursor-cloud-agent`. An important long-lived use may be pinned as a guest. A task call is a hidden run.

The only outbound host, in phase C, is `api.openai.com`. A user-supplied or "OpenAI-compatible" base URL is rejected. Paths are fixed. The model name goes in the body only. `max_tokens` is capped by a constant in the adapter. Config may lower that cap and MUST NOT raise it.

Env: one user env var, or the OS credential store. Same `key present: yes/no` rule.

Until phase C, `probe()` is `not_connected` (`needs owner`, or `adapter not enabled in this build` when the flag and the env var are both set). `talk()` is `queued`. `fetch` is not called.

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
| claude-cli | PATH `X_OK` on `claude`; spawn state only after talk | spawn on talk; queued if it cannot start | none | none | no | `not_connected` until the CLI is on PATH | hidden |
| cursor-cloud-agent | design only; skeleton probe | queued until phase C | Cursor API host, https, phase C only; none before that | OS credential store or one user env var | yes | off, `not_connected` | hidden |
| openai | design only; skeleton probe | queued until phase C | `api.openai.com` only, phase C; none before that | OS credential store or one user env var | yes | off, `not_connected` | hidden |
| grok-bot-bridge | existing crew-status heartbeat for that seat id | existing outbox and inbox | loopback `127.0.0.1` bridge only | none (shared bridge token is not a bot token) | no | `offline` until a real heartbeat | resident |
| ollama | existing loopback tags and ps probe | existing `/api/chat` | loopback `http` on `127.0.0.1` (and `::1` as today) | none | no | `offline` if unreachable | resident |
| kavi-bridge | existing local feed file, read-only | existing bridge-folder outbox; a coordinator relays | none from the office | none on the host | no | `offline` or `not_connected` from the file | resident |

Paid rows stay off. `key present` is `yes` or `no` and is not a fragment of the key. Hidden is the default tier for task providers even if someone later pays for a call.

## Security requirements

These are normative. Later phases MUST meet them. A review that finds a break sends that phase back.

1. **Keys.** MUST NOT create a key or an account without the owner's approval. Provider keys live only on the host, in the OS credential store (Windows Credential Manager) or a user env var. They MUST NOT be written to the repo, `workers.json`, `hq-local.json`, any `.agent-office` file, the client, the websocket, logs, chat, or transcripts. The server uses a key only to build an outbound call. Status shows `key present: yes` or `key present: no` and never a prefix or a suffix.
2. **Outbound.** Each adapter has a fixed host allowlist. Cloud calls are `https` only, with `redirect: 'error'`, a timeout, and a response byte cap (Content-Length checked before the body is read, same bar as `src/server/ollama.ts`). Endpoint paths are fixed constants. The model name goes only in the body. Cloud adapters MUST NOT accept a base URL from the user, from config, or from the message. Local ollama stays loopback `http` as it is today.
3. **Money.** Every paid adapter is OFF by default. Okkin and ollama stay the only free default path. Each paid call has a `max_tokens` ceiling. Each paid provider has a daily call cap and a daily token cap. Caps are constants; config may lower them and MUST NOT raise them. One global kill switch (a user env var, default off) turns every paid adapter off even when a key is present. Spend is logged locally, mode `0600`, as provider, project, seat, time, and counts. The log MUST NOT contain the prompt, the key, or the message. No automatic retry loop.
4. **Inbound.** MUST NOT open a tunnel, bind a public port, or add a listener. A cloud bot reaches the office only through the existing bridge folder, or by the office pulling outbound. A bot token is per bot and per seat, stored hashed, revocable, and MUST NOT act as the player or the owner or approve anything. The shared bridge token MUST NOT be used as that token. Anything that speaks as the owner stays session-only.
5. **Seats.** Honest status only (`offline`, `not_connected`, `queued`, `idle`, `working`), taken from real adapter state. Chairs follow Seat tiers. Adapter replies are always role `bot`, never `player`. Bot text is data: chat MUST NOT trigger a tool run, a file write, or a send. Work-pool gated-tier rules apply to adapters as claimers: level caps and an owner gate, per project. An adapter MUST NOT approve work, raise its own level, or pass the owner gate by itself.
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

### Registry

Projects are declared in gitignored local config, or read from the existing local board or pool, and loaded lazily when a summary page or a seat opens them. The repo ships no project list. Source MUST NOT contain a hard-coded array of projects. Absent config means an empty page, not a sample project.

### Status at scale

The office shows a summary: counts by status, Needs-owner items, and active runs, with filter and search. It does not draw 1000 desks. Rooms and chairs show the active subset only: residents, seated guests, and hidden runs that are actually in flight, capped to what the summary page asked for.

Status is pulled on demand (when the summary is opened) or by an event the process already has (a finished promise, or the existing crew-status file read). MUST NOT start a polling loop per project. A summary open reads the local index. It does not fan out a probe to every project. Probes of cloud adapters obey that adapter's rate limit and daily cap. Hidden runs contribute counts. They do not contribute chairs.

### Work pool and spend

Gated tiers apply per project: level caps and an owner gate. Adapters that claim work are claimers under those rules.

Spend caps apply per provider and also per project. Either cap stops the next paid call. The global kill switch stops all of them. Ollama is unchanged and is not metered as a paid provider.

### Storage

Records live in append-only files or a light local store under `.agent-office/`, mode `0600`, gitignored. The index is paginated. Memory holds the page being shown, not every project. MUST NOT keep an unbounded in-memory array of projects, runs, or transcripts.

Retention: transcripts and the spend log are reviewed and pruned at 30 days. Daily cap counters may keep one total per provider and per project for the current day, without the message text. A pruned record drops out of the index. Hidden-run rows follow the same 30-day rule once the run is finished.

### Honest status at every level

A seat is WORKING only while its adapter has a run in flight. A project is `active` only while a real run exists. A count on the summary is the number of those real states. Empty, unknown, and not-yet-loaded are not shown as active or WORKING.

## Phased rollout

Each phase is its own draft PR, then a security Crit, then the owner's Yes. A later phase does not start inside an earlier PR. No phase merges on its own from this plan.

**Phase A. Plugin seats (additive).** New `src/server/providers/seats/` registry. Resident entries and owner guest pins only. Existing crew desks, Okkin, the bridge, and kavi are not edited. No new outbound network. `cursor-cloud-agent` and `openai`, if a file exists at all, are skeletons: `probe()` follows the not-connected rules above, and tests assert `fetch` is never called. Task agents are not seated and are not spawned yet. `guestChairCap` is enforced. Acceptance includes: each adapter's status mapping; a missing provider is never WORKING; WORKING only while an in-flight promise is pending and clears on error; the registry rejects an unknown provider; a config `apiKey` field is rejected; a task run does not create a chair; a guest pin past the cap stays hidden; the current honesty tests (offline queued notice, no fake WORKING, no synthesized bot lines), Okkin model switch, bridge auth, rate limits, and 413 still pass without modification.

**Phase B. Project registry and summary board.** The project record, the lazy gitignored loader, and the summary (counts, Needs-owner, active runs, filter and search). Hidden runs appear here and only here. Local `claude-cli` may spawn on talk into a hidden run, still with no chair unless pinned. Still no paid outbound calls. Storage and retention from Scale direction land in this phase. The floor still draws only residents, seated guests, and the active subset.

**Phase C. Paid cloud adapters.** `cursor-cloud-agent` and `openai` may call their fixed hosts only after the owner has approved that key and turned the kill switch on. Default remains off. Short-lived runs stay hidden. A guest chair still requires an owner pin and a free slot under the cap. Per-provider and per-project spend caps apply. No automatic retry.

## What this PR does not do

This change is the plan page only. It does not add adapters, routes, seats, keys, listeners, or dependencies. The current foundation stays as it is.
