# Kavi Notion modules

Phone HQ for Nick. One page, four databases, no fifth, no automation, no template. Checked on the live Crew Front Desk on 2026-10-25.

**Page:** [Crew Front Desk](https://app.notion.com/p/403e7aa3897681568be4cc639dc48aba)

Kavi decides life items and, when george is Usage empty, routing. She does not get a MuseBot Notion login. Cursor writes Notion. george routes only while Crew Status **Router** shows State ON. Grok Bot stays Parked.

Home open stays the two power-ons in [HOME-OPEN-CHECKLIST.md](HOME-OPEN-CHECKLIST.md). Cover packets stay in [KAVI-COVERS-GEORGE.md](KAVI-COVERS-GEORGE.md). This file is the view map and the hook.

## Page order

1. Callout: tell george Yes or No. A click is not an approval.
2. **Phone** — Needs Nick
3. **Crew** — Crew Status
4. **Work** — Work Queue
5. **Life** — Life Admin
6. Never-list callout
7. **Route**, **Life hook**, **Kill switches**, **Owners** — on the page as of 2026-10-25 19:41 UTC

## Views already on the databases

Leave these. Do not rebuild them.

| Database | View | Type | Filter | Shows |
|---|---|---|---|---|
| Needs Nick | Awaiting | table | Status is Awaiting Nick | Item, Question, Gate, Age days, Asked on. Sort Asked on ascending |
| Needs Nick | All | list | none | Item, Status, Gate, Nick answered at |
| Crew Status | Now | table | none | Name, State, Kind, Note, Stale, Last heartbeat |
| Crew Status | By state | board | none | Group by State, hide empty. Name, Kind, Note |
| Work Queue | Open | table | Status is not Done and not Killed | Task, Status, Lane, Priority, Next action, Stuck if no update by, Overdue, Ref, Type |
| Work Queue | By lane | board | same as Open | Group by Lane, hide empty |
| Work Queue | Done | table | Status is Done or Killed | Task, Status, Lane, Next action, Ref |
| Life Admin | Open | table | Status is not Done | Item, Status, Kind, Due, Owner, Amount, Autopay. Sort Due ascending |
| Life Admin | All | table | none | Item, Status, Kind, Due, Owner, Amount, Notes |

Lane and Prepared by are george, Kavi, ForgeL, Dan, Jack, Cursor. Grok Bot is not a lane.

## Views added and proved

Each view was created, fetched back, and queried. Counts below are that query. No row body is copied here.

### Work Queue — Route

Board. This is the routing surface.

- Filter: Status is not Done, and Status is not Killed
- Group by Status, empty groups shown
- Cards: compact. Task, Lane, Next action, Priority, Stuck if no update by
- Sort: Stuck if no update by, ascending
- View: `view://404e7aa3-8976-816e-8425-000c9d64d585`
- Proof: 4 cards, every one Status = Routed

### Life Admin — Gate

List. This is the life hook's source. It is not the phone.

- Filter: Status is Needs Nick
- Show: Item, Kind, Due, Owner. Amount, Notes, and Link stay hidden
- Sort: Due, ascending
- View: `view://404e7aa3-8976-8158-ba7e-000c20899e9b`
- Proof: 0 rows

### Crew Status — Router

List. One seat.

- Filter: Kind is Router
- Show: Name, State, Note, Stale
- View: `view://404e7aa3-8976-8129-884c-000c3510d97a`
- Proof: 1 row, Name george, State ON

Phone **Awaiting** at the same time: 0 rows. Needs Nick otherwise holds one Answered Yes and one Parked.

## Life hook

No relation and no automation. A Life Admin status does not create a phone row.

1. Kavi has a real bill, renewal, or appointment that needs a Yes or No from Nick. She does not invent one.
2. Kavi writes one Life Admin row, or Cursor writes it from her bridge note: Item (short title), Kind, Due, Status = Needs Nick, Owner = Nick. Notes stay empty of secrets. Amount stays on this row only. Link is never Major Files.
3. The row shows on **Gate**. It still does not show on Phone.
4. While Router State is ON, george copies the item title and one question onto Needs Nick. Status = Awaiting Nick. Prepared by = Kavi. Gate is one of G1 Worth-it, Access, Spend, Delete, Send outside crew, Publish, Create or retire bot, Live change, Force-push, Other. He writes Nick's words only after Nick says them.
5. While Router State is Usage empty, Kavi puts the same decision in a `COVER GEORGE` file. Cursor applies it. Cursor does not create a Needs Nick row from a cover file unless the row already exists. A new phone row while george is Usage empty waits until george is ON, or until Nick has already said the words and the Needs Nick row is already there for the quote.
6. Do not copy Amount, Notes, account numbers, or the Life Admin link onto Needs Nick or Work Queue.

## If a view tab is missing

On that database, Add view, then match the table above. Notion's filter row is enough. Do not add a property to make the view work. Do not add a database.

Route, if the tab is gone: Board, name Route, group by Status, show empty groups, filter Status is not Done and is not Killed, card preview Task, Lane, Next action, Priority, Stuck if no update by.

Gate, if the tab is gone: List, name Gate, filter Status is Needs Nick, properties Item, Kind, Due, Owner.

Router, if the tab is gone: List, name Router, filter Kind is Router, properties Name, State, Note, Stale.

## Kill switches

Same seven as [STABLE-6-12MO-PLAN.md](STABLE-6-12MO-PLAN.md). They are also a table on the Front Desk page. The owner writes the note on Crew Status. Nobody asks Nick as part of home open.

| ID | Trips when | Action | Owner |
|---|---|---|---|
| K-WAKE | Wake, magic packet, or SSH at a machine that is off | Stop. Wait until Nick opened that desktop | Jack |
| K-BIND | The office listens on every interface | Stop it. Start again on loopback | Jack |
| K-SECRET | A secret, token, password, account or card number, student data, Major Files, or a machine address is on the Front Desk | Trash that row. Do not copy it into git | Dan |
| K-GROK | Grok Bot writes the Front Desk or starts a routine | Revert the write. Row stays Parked | Dan |
| K-SPEND | A step needs a new account, a paid plan, or on-demand charges | Stop. Leave the service OFF | The lane that hit it |
| K-SURVEY | A template survey, premortem, fact-check list, or replay corpus | Trash the row | Cursor |
| K-ASK | A bot is about to message Nick for a login, a key, a share, or a deploy OK | Do not send it. Set that row's Status to Blocked | george, or Cursor while Kavi covers |

## Owners

| Who | Keeps true | Does not |
|---|---|---|
| Nick | Opens the ProArt. Opens the Mac. Says Yes or No to george | Run the desk, share Notion, create accounts |
| george | Router tab while State is ON. Lane, Status, quote, time | Task bodies. Routing while Usage empty |
| Kavi | Life items, bridge-issue titles, COVER GEORGE while george is Usage empty | MuseBot login, messaging the other lanes, Major Files |
| Cursor | Page structure, these views, heartbeats, applying cover orders | A fifth database, an automation, a cover file the parser rejects |
| Jack | ProArt listen checks | Wake a machine |
| ForgeL | Office PRs and GitHub issue links on Work Queue | Merge, force-push |
| Dan | K-SECRET and K-GROK | A new data-class document |
| Grok Bot | Nothing | Writes, routines, spend |

## Schemas

Properties that already exist. Do not add one for these modules.

**Needs Nick.** Item (title). Status: Awaiting Nick, Verify still open, Answered Yes, Answered No, Parked, Withdrawn. Gate: G1 Worth-it, Access, Spend, Delete, Send outside crew, Publish, Create or retire bot, Live change, Force-push, Other. Question, Nick quote, Asked on, Nick answered at, Prepared by, Link, Age days (formula).

**Work Queue.** Task (title). Ref. Status: Inbox, Routed, In progress, Blocked, Waiting on Nick, Done, Killed. Lane. Priority: High, Normal, Low. Type: Request, Handoff, Issue, Decision, Fix. Next action. Stuck if no update by. Overdue (formula). Source: Nick, Kavi bridge, george sweep, Lane, Audit. Link. Created. Last update.

**Crew Status.** Name (title). State: ON, OFF, Usage empty, Parked, Excluded, Unknown. Kind: Router, Lane, Bot, Machine, Service. Note. Stale (formula). Last heartbeat. Heartbeat every min. Runtime. Usage pool.

**Life Admin.** Item (title). Status: Upcoming, Handled by Kavi, Needs Nick, Done, Snoozed. Kind: Bill, Renewal, Appointment, Inbox follow-up, Document, Subscription, Other. Due. Owner: Kavi, Nick. Amount. Autopay. Notes. Link.

Amount never leaves Life Admin. Notes never hold an account number, a card number, or a secret.

## Not in this pack

- A fifth database, a relation, an automation, Notion AI, Notion Mail, Notion Calendar
- A template rebuild
- A Needs Nick row that shares the desk with MuseBot
- Seed Life Admin rows
- Grok Bot access
