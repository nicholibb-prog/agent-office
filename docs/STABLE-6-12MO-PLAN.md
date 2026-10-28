# Stable crew, 6–12 months

Working system only. Checked against this repo at `015b56a` and the Crew Front Desk as cleaned on 2026-10-24. No template survey, no premortem packet, no new Notion database.

Nick powers on the ProArt and the Mac. [HOME-OPEN-CHECKLIST.md](HOME-OPEN-CHECKLIST.md) is that procedure. This page is what has to stay true after that, and who fixes it when it breaks.

## What runs

| Piece | Where it lives | On means | Owner |
|---|---|---|---|
| agent-office | This repo, on the ProArt | HTTP on `127.0.0.1:4600` only. Default bind is `127.0.0.1` (`src/server/config.ts`). `HOST` is ignored. | Jack starts it. ForgeL changes code by PR. |
| Okkin | Ollama on the ProArt, `http://127.0.0.1:11434` only | `GET /api/tags` returns 200. Any other host is refused by `src/server/ollama.ts`. | Jack |
| crew-router | Not in this repo. Loopback `127.0.0.1:4317` when a unit is already installed | Socket is loopback, or the row stays OFF | Jack |
| Tailscale | The Mac and the ProArt, one tailnet | Both notes say `tailscale Running`. Serve runs on the ProArt only, and points 443 at `127.0.0.1:4600` only after the office listen check passes. The Mac does not serve. No auth key in git or on the Front Desk. Steps: [TAILSCALE-CREW.md](TAILSCALE-CREW.md) | Jack on the ProArt. Kavi on the Mac. |
| Kavi bridge | Drive folders `to-george`, `to-kavi`, `in`, `out` on the Mac sync | Both `to-*` folders exist and are not symlinks. Office env `AGENT_OFFICE_KAVI_BRIDGE_DIR` | Kavi |
| Front Desk | Private Notion page Crew Front Desk | Four databases only: Needs Nick, Work Queue, Crew Status, Life Admin | Cursor writes. Kavi writes Life Admin and bridge issue rows. george routes. When george is Usage empty, Kavi covers through the bridge and Cursor applies it ([KAVI-COVERS-GEORGE.md](KAVI-COVERS-GEORGE.md)). |
| ISSUES | GitHub issues on the floor, plus Work Queue Type = Issue | `gh issue list` exits 0. Each open issue has a Work Queue link or a recorded skip | ForgeL for GitHub. Kavi for bridge issues |
| Grok Bot | Crew Status row Parked | No Notion writes, no routines, no spend | Dan, if it wakes |

DeepSeek is not the default. Cursor is the default. DeepSeek runs only when crew-router's socket is up and Cursor usage is gone. Okkin runs private or grey work only, and only on that loopback. If either is down, the work waits. It does not move to a cloud model.

## Usage

| Work | Who | Pool |
|---|---|---|
| Code, Front Desk edits, heartbeats, bulk reading | Cursor (Grok 4.7 on this lane) | Cursor |
| Life admin, bridge files, bridge issue rows | Kavi | Muse |
| ProArt listen checks, office process, Okkin socket, crew-router socket | Jack | Local. No model required |
| Forbidden-data read, security review of a PR that touches bridge, auth, router, or Okkin | Dan | Cursor |
| Routing a row, recording Nick's quote + time | george, while State is ON | No deliverable text |
| The same routing, only while george State is Usage empty | Kavi decides. Cursor writes Notion | Muse for the decision, Cursor for the write. Kavi does not message the lanes |
| Anything | Grok Bot | Do not call it |

If Cursor usage would roll into on-demand charges, the lane writes `usage-exhausted at step N` on Crew Status and stops. That is the kill. It does not switch on Grok Bot, and it does not open a new paid account.

## Front Desk rules

- Needs Nick **Awaiting** is the only phone list. It is empty until a real gate exists. Power-on is not a row.
- An approval is Nick's Yes to george with the quote and the time. A Notion click is not an approval.
- Work Queue rows have a lane, a next action, and `Stuck if no update by`. Overdue is the formula already on the database. Nobody pages Nick because a formula is true.
- Crew Status Stale is the formula already on the database (no heartbeat for 2 intervals). Heartbeat every min = 30 on ON rows. An OFF row does not get a heartbeat.
- Life Admin is metadata Kavi enters while she works: item, kind, due, status, owner. No account numbers, no card numbers, no Major Files links.
- Do not add a database, an automation, a Notion AI agent, Notion Mail, or Notion Calendar.

## ISSUES

The sink is GitHub issues plus Work Queue rows of Type = Issue. There is no separate issue product.

- ForgeL runs `gh issue list --state open --limit 50 --json number,title` after the office is up.
- Kavi files still-open bridge issues as WQ rows (title, lane, link). Bodies stay in the bridge file.
- TutorL issues never get a row. Student data never gets a title.
- This repo has no auto-review workflow and no CODEOWNERS. Do not add one for prestige. A PR that touches the bridge, auth, the router, or Okkin waits for Dan. Bots do not merge, do not enable auto-merge, and do not force-push.

## Kill switches

Any one of these stops the new work. The owner writes the note. Nobody asks Nick as part of home open.

| ID | Trips when | Action | Owner |
|---|---|---|---|
| K-WAKE | Someone sends a wake, magic packet, or SSH at a machine that is off | Stop. Wait until that desktop exists because Nick opened it | Jack |
| K-BIND | `0.0.0.0:4600` or `[::]:4600` is listening | Stop that listener. Start again with `--host 127.0.0.1` | Jack |
| K-TS | A `tskey-` string is in git or on the Front Desk | Remove it. Do not write a replacement into the row | Dan |
| K-SECRET | A secret, token, password, account or card number, student data, Major Files content, or a machine address is in Notion | Trash that row. Do not copy it into git | Dan |
| K-GROK | Grok Bot writes Notion or starts a routine | Revert the write. Row stays Parked | Dan |
| K-SPEND | A step needs a new account, a paid plan, or on-demand charges | Stop. Leave the service OFF | The lane that hit it |
| K-SURVEY | A task is a template survey, a premortem packet, a fact-check list, or a replay corpus | Trash the row. Do not do the task | Cursor |
| K-ASK | A bot is about to message Nick for a login, a key, a share, or a deploy OK | Do not send it. Record Blocked on the row | george, or Cursor while Kavi is covering |

## Owners

| Owner | Keeps true | Does not |
|---|---|---|
| Nick | Opens the ProArt. Opens the Mac | Run commands, share Notion, create accounts, approve deploys on the way in |
| Jack | B1–B4 in the home checklist | Wake a machine, read the power-file, pull a model |
| Kavi | Bridge heartbeat, Life Admin, WQ-7, and COVER GEORGE orders while george is Usage empty | Talk to other lanes, Notion itself, questionnaire, Major Files |
| ForgeL | Office PRs, `gh issue list`, Work Queue links for those issues | Merge, force-push, `gh auth login` |
| Dan | K-SECRET read, security PR review | A new data-class research document |
| george | Awaiting count and quote + time while State is ON | Author a task body, route while Usage empty |
| Cursor | Front Desk structure, heartbeats, killing survey rows, applying Kavi cover orders | Grok Bot, new databases, applying a cover file the parser rejects |
| Grok Bot | Nothing | Everything |

## Acceptance tests

Re-run these any month. Public output only: PASS, FAIL, and a count. No file names from the bridge, no model lists, no secrets.

| # | Test | Pass |
|---|---|---|
| A1 | Home checklist Nick section | Two steps, and no third step has been added |
| A2 | ProArt listen check in B2 | `PASS`, curl `200`, `302`, or `401` |
| A3 | Wide bind | No `0.0.0.0:4600` and no `[::]:4600` |
| A4 | Okkin | `GET http://127.0.0.1:11434/api/tags` is 200, or Crew Status says `okkin down` and no cloud fallback happened |
| A5 | crew-router | Socket `127.0.0.1:4317` is up, or the row is OFF because no unit exists |
| A6 | Bridge | B5 prints `PASS`, or WQ-7 is Blocked with `bridge dir missing` / `wait for Mac wake` |
| A7 | Needs Nick Awaiting | 0 rows |
| A8 | Grok Bot | State = Parked, and it has no edit on the Front Desk since 2026-10-24 |
| A9 | Work Queue | Every open row has Lane and Next action. Every open row except the standing Kavi-cover watch has Stuck if no update by |
| A10 | ISSUES | `gh issue list` exit 0, or the note is `gh not logged in` / `gh not found` with no login attempt |
| A11 | Secrets | Dan's latest note is `KS1 pass` |
| A12 | Survey | No Work Queue row whose task is a template survey, premortem, fact check, or replay corpus |
| A13 | Kavi cover | `parseCover` accepts the ON, OFF, and order samples in [KAVI-COVERS-GEORGE.md](KAVI-COVERS-GEORGE.md) and rejects Waiting on Nick, Grok Bot, and Major Files. A cover file never creates a Needs Nick row |
| A14 | Tailscale | Both machine notes include `tailscale Running`, the ProArt note includes `tailscale serve on`, and the office listen check is still loopback. Or the note is `tailscale NeedsLogin` and the login URL is only on the Work Queue Link. The Mac does not serve |

A fail on A4 or A5 with the row left OFF is a stable degrade. A fail on A2, A3, A7, A8, or A11 is a stop. The owner in the table fixes it. Nick is not the owner of those rows.

## Cancelled

These are not coming back. The trash list and the live page URLs are in [FRONT-DESK-CLEANUP.md](FRONT-DESK-CLEANUP.md).

- Notion template gallery survey and "make over" of old templates
- Premortem-backtest as a gate before the desk can be used
- Fact-check track U1–U8, replay corpus R1–R12, artifact sha theater
- Kavi Q1–Q7 questionnaire
- `security/data-classes.md` as a research deliverable (the never-list on the Front Desk page stays)
- A Nick step to create a DeepSeek account or to approve a ProArt deploy
- A Nick step to share the Front Desk with MuseBot (Cursor already writes it; Kavi stays on the bridge)
- Grok Bot Notion access and Grok Bot routines
