# Kavi covers george

Kavi is the Muse bot (`muse` in this office, Crew Status runtime **Muse app**). Muse connects on its own path: the Muse app, and the Drive bridge folders `to-kavi` and `to-george`. That path is not a crew seat. Crew seats stay `seat-1` through `seat-9` and `okkin`. Muse is not a Notion member. The Work Queue value `Kavi` is a lane label on a row. The other lanes read the row after Cursor applies it. They do not get a message from the Muse bot.

George routes in Notion while his usage is up. When that usage is empty, the Muse bot covers the routing fields on existing rows: Status, Lane, Next action, and stuck time. It writes `COVER GEORGE` on the bridge. Cursor, on a different usage pool, applies those fields in Notion.

Nick does nothing for this. Do not ask him to share Notion, to wake a machine, or to refill george's usage.

## When it starts

Cursor sets Crew Status **george** to **Usage empty** when any of these is true:

- george's own last note is `usage-exhausted at step N`
- george's State was ON and the Stale formula is true for two heartbeat intervals (60 minutes at Heartbeat every min = 30)
- the Grok pool george was running on is empty

Cursor does not start Grok Bot to find out. A missing heartbeat is enough.

Pass: george State = Usage empty, Note = `cover on`, and one file is in the bridge `to-kavi` folder. Fail: george is marked Usage empty and `to-kavi` has no new digest. stuck_if: 30 minutes after the empty condition, still no digest. Cursor writes the digest. Kavi is not pinged any other way.

## What Cursor writes (to-kavi)

File name: `cover-george-on-<YYYYMMDDTHHMMZ>.md`. Create only. Do not overwrite. Body, nothing else:

```text
COVER GEORGE ON
at: 2026-10-25T01:00:00Z
reason: usage-empty
row: WQ-7 | Routed | Kavi | 2026-10-25T18:00:00Z | file open bridge issues
```

One `row:` line per open Work Queue row that is not Done and not Killed. Five fields, separated by ` | `: ref, status, lane, stuck time UTC, next action. No body, no link URL, no names of files, no dollar amounts. At most 20 rows. If there are more, send the oldest stuck times first and a second file.

`src/shared/kavi-cover.ts` `parseCover` must return ok. If it does not, do not drop the file.

## What the Muse bot writes (to-george)

The Muse bot reads that digest and writes one reply. File name: `<YYYY-MM-DD-HHMM>-cover-george.md`. No other lane writes this file.

```text
COVER GEORGE
at: 2026-10-25T01:10:00Z
set: WQ-7 | In progress | ForgeL | 2026-10-26T18:00:00Z | open the PR
quote: Notion path GO (G1) | Yes, ship it | 2026-10-25T01:09:00Z
```

`set:` is ref, status, lane, stuck time, next action. `quote:` is optional and only when Nick already said the words to Kavi. Item title, exact words, UTC time. One quote line.

Kavi may set status to Inbox, Routed, In progress, Blocked, Done, or Killed. Kavi may set lane to Kavi, ForgeL, Dan, Jack, Cursor, or george. Kavi may not set Waiting on Nick, Grok Bot, TutorL, PolishL, ScoutL, Arbiter, or Bench. Kavi may not put a secret, a card number, student data, or Major Files in the file. The parser rejects those.

Kavi does not message ForgeL, Dan, Jack, Cursor, or george. The lanes see the Work Queue row after Cursor applies it.

## What Cursor applies

Only while george State is Usage empty, and only a file whose first line is `COVER GEORGE` and whose `parseCover` is ok.

| Packet field | Notion field |
|---|---|
| set ref `WQ-n` | Work Queue row with that Ref |
| set status | Status |
| set lane | Lane |
| set stuck | Stuck if no update by |
| set next | Next action, one line |
| quote item | Needs Nick row with that Item title, and only if it already exists |
| quote text | Nick quote |
| quote at | Nick answered at |
| quote present | Status = Answered Yes. Cursor does not invent the words |

Cursor does not create a Needs Nick row from a cover file. Cursor does not copy the packet into git. On the Work Queue row, Source stays as it was. Note on george: `cover on`.

Pass: every `set` line matches the row after the edit. Fail: parser not ok, or the edit would create a Needs Nick row. Leave the file unapplied and write `cover rejected` on the Work Queue row "Apply Kavi cover while george usage is empty". stuck_if: a valid order sits in `to-george` for 30 minutes with no Notion edit. Cursor applies it. Do not ask Nick.

## When george is back

George's usage pool can route again. Cursor sets george State = ON, Note = `cover off`, and writes:

```text
COVER GEORGE OFF
at: 2026-10-25T02:00:00Z
reason: usage-back
```

File name: `cover-george-off-<YYYYMMDDTHHMMZ>.md` in `to-kavi`. After that file, Cursor ignores new `COVER GEORGE` orders until the next ON digest. George routes again. Kavi goes back to life/admin and bridge issues only.

## Standing row

Work Queue: **Apply Kavi cover while george usage is empty**. Lane Cursor. It stays Routed. Stuck if no update by stays empty while cover is off, so the row does not look overdue. While cover is on, Cursor sets that stuck time 24 hours ahead each time it applies or rejects a file.
