# Front Desk cleanup

**Page:** private Crew Front Desk, read back 2026-10-24 22:55 UTC. Not published. This file has titles and public URLs only. The views that make this page the phone HQ are in [KAVI-NOTION-MODULES.md](KAVI-NOTION-MODULES.md).

**Order applied:** Nick, 2026-10-24 4:51 PM MT. Stop rebuilding Notion from templates. Delete the work that is not the operating desk. Kavi and Cursor run it. Grok Bot does not.

## Verdict

| Section | Result | Why |
|---|---|---|
| Four ops databases | PASS | Needs Nick, Work Queue, Crew Status, Life Admin are still the only databases on the page |
| Rules page | PASS (removed) | Trashed. It did not run a queue. The never-list is on the Front Desk page itself |
| Survey and research rows | PASS (removed) | Trashed. They were a second project in front of the desk |
| Extra Nick asks | PASS (removed) | Trashed, so Awaiting is empty and home open stays two steps |
| Program-only lanes | PASS (removed) | PolishL, ScoutL, Arbiter, Bench trashed. They had no ops job on this desk |
| Needs Nick Awaiting | PASS | 0 rows. Left: G1 Answered Yes, Grok Bot Parked |
| Work Queue | PASS | One row, WQ-7, Kavi, the bridge-issue handoff |
| Life Admin | PASS | 0 rows. Kavi fills it with real items. No seed fiction |
| Crew Status | PASS | 13 rows: the machines, the services, and the lanes that run them |
| Template rebuild | PASS (cancelled) | No template was applied. No fifth database |
| Grok Bot writes | PASS | Parked. This cleanup was Cursor |
| Multi-database SQL after the edit | BLOCKED | A later query across all three databases at once was refused for plan entitlement. Each database was queried on its own and matched this file. No trial was started |

## Kept

| Object | URL | Rows left |
|---|---|---|
| Crew Front Desk | https://app.notion.com/p/403e7aa3897681568be4cc639dc48aba | Phone, Crew, Work, Life. Four inline databases. No Rules child |
| Needs Nick | https://app.notion.com/p/6ceb05f6480a4f8caa1b40027c8e4490 | Notion path GO (G1) = Answered Yes. Grok Bot Notion access = Parked |
| Work Queue | https://app.notion.com/p/41c1e5c3778c43d89cc69d35eefacb8c | WQ-7 File open bridge issues on Work Queue. Lane Kavi. Status Routed. Stuck if no update by 2026-10-25 12:00 MT |
| Crew Status | https://app.notion.com/p/02a41468405343668c769245cf215474 | agent-office, crew-router, Cursor, Dan, ForgeL, george, Grok Bot, Jack, Kavi (MuseBot), Mac, ProArt, Side Lanes, TutorL |
| Life Admin | https://app.notion.com/p/28565fd5a8b340ec9888a79189843d12 | none |

TutorL stays Excluded. Side Lanes stay Parked. Grok Bot stays Parked. ProArt, Mac, and crew-router stay OFF until Nick opens the machines and Jack's checks pass.

## Trashed

Notion trash, 2026-10-24. Restore only if a row below was an ops record. None of these are.

| Title | Was | URL |
|---|---|---|
| Verify Notion facts U1–U8 | Work Queue, ScoutL, fact-check track | https://app.notion.com/p/403e7aa38976810684dcf3c4786a13d0 |
| Replay corpus R1–R12; replay v1 | Work Queue, Arbiter | https://app.notion.com/p/403e7aa389768114a0b0e1ee4e3280dd |
| Apply premortem-backtest to Front Desk v1 | Work Queue, ForgeL | https://app.notion.com/p/403e7aa38976817e843efea12ae96763 |
| Verify artifact sha256 | Work Queue, Bench | https://app.notion.com/p/403e7aa389768188a2fed2d5add9f54e |
| Answer Q1–Q7 (bridge packet) | Work Queue, Kavi questionnaire | https://app.notion.com/p/403e7aa3897681a9a9b0d91ae1569519 |
| Data classes + capability matrix; audit v1 | Work Queue, Dan research doc | https://app.notion.com/p/403e7aa3897681c89781cbf2f8f1ef2a |
| DeepSeek provider account + key for crew-router | Needs Nick, Spend, would have been a third Nick step | https://app.notion.com/p/403e7aa3897681a1a3f3dffe4fa223d1 |
| ProArt restart/deploy OK | Needs Nick, Live change, would have been a third Nick step | https://app.notion.com/p/403e7aa3897681f3a7e3c585af79a40f |
| Give Kavi (MuseBot) access to Crew Front Desk | Needs Nick, Awaiting Nick | https://app.notion.com/p/403e7aa3897681bd9cb8ce0dd7069e87 |
| PolishL | Crew Status, no ops job | https://app.notion.com/p/403e7aa38976810e9362d76d04151f4a |
| ScoutL | Crew Status, survey lane | https://app.notion.com/p/403e7aa38976819395cec86ab6ad6a63 |
| Arbiter | Crew Status, replay lane | https://app.notion.com/p/403e7aa389768168bf55e02969c1ac81 |
| Bench | Crew Status, sha lane | https://app.notion.com/p/403e7aa389768179a458c531ebc35e18 |
| Rules | Child page, policy duplicate | https://app.notion.com/p/403e7aa38976811e8881fb06a3077a56 |

No database was trashed.

## Cancelled plans

Do not dispatch these. If a row for one appears, trash it (kill switch K-SURVEY in the stable plan).

| Plan | Why it is cancelled |
|---|---|
| Template gallery survey, pass 1–3, corpus.csv, deep-reads | Nick: do not make over old templates |
| Premortem-backtest skill, self-test, verdict packet | Gate theater in front of a desk that already exists |
| Replay corpus and independent re-run | Same |
| Notion facts U1–U8 | Research, not an operator step |
| Kavi Q1–Q7 | A questionnaire. She writes Life Admin rows when there is a real item |
| security/data-classes.md as a document project | The never-list on the Front Desk page is the rule Dan enforces |
| Sha-verify of the planning artifacts | The artifacts are not the running system |
| GitHub-only fallback that builds needs-nick queues, detectors, and CODEOWNERS | Prestige. GitHub issues and Work Queue are already the sink |
| New Notion integrations, bots, automations, AI, Mail, Calendar | Out of the working set |

## What Cursor already changed

1. Trashed the 14 rows and the Rules page through the Notion connector.
2. Rewrote the Front Desk intro so it no longer points at Rules or at the planning artifacts. The four database blocks stayed.
3. Renamed the one remaining handoff to "File open bridge issues on Work Queue" and set the next action so Kavi files titles and links only.

Nothing here wakes the ProArt or the Mac.

## How the page reads

Checked 2026-10-25 12:56 PM MT. Same four databases. They sit inline on [Crew Front Desk](https://app.notion.com/p/403e7aa3897681568be4cc639dc48aba), in this order: Phone, Crew, Work, Life.

| Database | Home view | Also |
|---|---|---|
| Needs Nick | Awaiting. Status = Awaiting Nick. Item, question, gate, age, asked on | All, the answered and parked rows |
| Work Queue | Open. Done and Killed hidden. Task, status, lane, priority, next action, stuck time, overdue, ref, type | By lane (empty lanes hidden). Done |
| Crew Status | Now. Name, state, kind, note, stale, last heartbeat | By state (empty states hidden) |
| Life Admin | Open. Done hidden, sorted by due | All |

Lane on Work Queue is george, Kavi, ForgeL, Dan, Jack, Cursor. PolishL, ScoutL, Arbiter, Bench, and Grok Bot are not choices. Prepared by on Needs Nick is the same six. A row still opens with status, lane, and next action pinned. No fifth database.
