# Home open checklist

**Order:** Nick, 2026-10-24 4:51 PM MT. He is going to work. Kavi and Cursor run the system. Grok Bot does nothing.

Nick's home actions are two power-ons. This file is those two steps, then the bot steps that run by themselves. A bot that is blocked writes its own row. It does not ask Nick.

No remote wake. No SSH to a machine that is off. No new account, no spend, no delete of a machine file, no force-push, no token pasted into chat, Notion, or this repo.

## Nick — step 1 of 2 — ProArt

1. Open the lid, or press the power button, on the ProArt.
2. If the lock screen is up, sign in with the login he already uses for that machine. That sign-in is part of this step.
3. Wait until the desktop is visible.
4. Stop. Do not open Notion, a browser, a terminal, SSH, or a password manager. Do not start a program by hand.

| Line | Result |
|---|---|
| Pass | The ProArt desktop is on the screen. |
| Fail | The machine is still off, or he opened anything other than the login screen. Close the extra window. The step is still only the desktop. |
| stuck_if | Not a Nick timer. Jack starts his clock only after this desktop is up. |

## Nick — step 2 of 2 — Mac

1. Open the lid, or press the power button, on the Mac.
2. If the lock screen is up, sign in with the login he already uses for that Mac. That sign-in is part of this step.
3. Wait until the desktop is visible.
4. Stop. Same closed list as step 1.

| Line | Result |
|---|---|
| Pass | The Mac desktop is on the screen. |
| Fail | The Mac is still off, or he opened anything other than the login screen. |
| stuck_if | Not a Nick timer. Kavi starts her clock only after this desktop is up. |

Nick is done. The Needs Nick view **Awaiting** is empty (checked 2026-10-24 22:55 UTC: the only rows left are "Notion path GO (G1)" = Answered Yes, and "Grok Bot Notion access" = Parked). He does not answer a row to make the crew start.

## Bots — after both desktops are up

Run in this order. Each owner posts the pass or fail line on Crew Status (Note) and does not message Nick. `stuck_if` is 30 minutes after that machine's desktop is up, unless a row below names a clock.

Grok Bot's order is: do not run. Leave the Crew Status row **Parked**. Do not call Notion. Do not start a routine.

### B1. Jack — ProArt is a local session

On the ProArt, in the logged-in session:

```bash
# Linux
uptime -s && echo PASS
```

```powershell
# Windows
(Get-CimInstance Win32_OperatingSystem).LastBootUpTime
echo PASS
```

| Line | Result |
|---|---|
| Pass | A boot time prints, and the command ran on the ProArt keyboard session, not over a wake packet. |
| Fail | The command was sent at a machine that was still off. Stop. Do not retry from another host. |
| stuck_if | No boot time 5 minutes after Nick's step 1. Note `ProArt still off`. Do not ask Nick. |

Then set Crew Status **ProArt** = ON, **Jack** = ON, Runtime = ProArt local. Last heartbeat = now. Heartbeat every min = 30.

### B2. Jack — agent-office on 127.0.0.1:4600

Listen check, ProArt:

```bash
# Linux. PASS only for loopback. FAIL if 0.0.0.0 or :: is bound.
ss -ltn | awk '
  $4 ~ /127\.0\.0\.1:4600$/ || $4 ~ /\[::1\]:4600$/ {ok=1}
  $4 ~ /(0\.0\.0\.0|\*|\[::\]):4600$/ {bad=1}
  END { if (bad) {print "FAIL wide-bind"; exit 1} if (ok) {print "PASS"; exit 0} print "FAIL down"; exit 1 }
'
```

```powershell
# Windows
$lines = netstat -ano | Select-String ':4600\s'
$bad = $lines | Select-String '0\.0\.0\.0:4600|\[::\]:4600'
$ok = $lines | Select-String '127\.0\.0\.1:4600|\[::1\]:4600'
if ($bad) { 'FAIL wide-bind' } elseif ($ok) { 'PASS' } else { 'FAIL down' }
```

If the line is `FAIL down`, start the office that is already installed. Do not install, and do not create a service unit.

```bash
# Look for an existing user unit. Start it only if a name is printed.
systemctl --user list-units --type=service --all --no-pager --plain | grep -i agent-office || true
```

If a unit name is printed and it is inactive: `systemctl --user start` that exact name. If no name is printed:

```bash
agent-office --host 127.0.0.1 --port 4600 --no-open
```

`HOST` in the environment is ignored by the office. Do not pass `--host 0.0.0.0`. Do not print the office password. Do not pass `--password`.

Re-run the listen check.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:4600/
```

| Line | Result |
|---|---|
| Pass | Listen check prints `PASS`, and curl prints `200`, `302`, or `401`. |
| Fail | `FAIL wide-bind`: stop the wide listener and start again with `--host 127.0.0.1`. `FAIL down` after the start command: Crew Status **agent-office** = OFF. |
| stuck_if | Still `FAIL down` 30 minutes after B1 pass. Note the curl error word (`refused` or `timeout`) only. Do not ask Nick. |

Set **agent-office** = ON only on Pass. Heartbeat every min = 30.

### B3. Jack — Okkin / Ollama on 127.0.0.1:11434

```bash
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:11434/api/tags
```

| Line | Result |
|---|---|
| Pass | HTTP `200`. Crew Status note `okkin loopback 200`. Do not print the model list into Notion or git. |
| Fail | Any other result, including connection refused. Leave Okkin off. |
| stuck_if | Not 200 at 30 minutes after B1. Note `okkin down`. Do not ask Nick. |

Do not open the office power switch. That switch needs the owner passphrase, which would be a third Nick step. Do not read or edit `.agent-office/okkin-power.json`. Do not pull a model. Private or grey work waits on this loopback. It does not go to a cloud model.

### B4. Jack — crew-router on 127.0.0.1:4317

This process is not in the agent-office repo. The crew's loopback for it is `127.0.0.1:4317`. Check that socket. Do not invent a unit file.

```bash
# Linux
ss -ltn | awk '$4 ~ /127\.0\.0\.1:4317$/ {found=1} END {if (found) print "PASS"; else print "FAIL down"}'
```

```powershell
# Windows
$ok = netstat -ano | Select-String '127\.0\.0\.1:4317\s'
if ($ok) { 'PASS' } else { 'FAIL down' }
```

If `FAIL down`, list existing units only:

```bash
systemctl --user list-units --type=service --all --no-pager --plain | grep -Ei 'crew-router|deepseek' || true
```

Start a unit only when that command prints its name. If it prints nothing, leave **crew-router** = OFF. Do not create a DeepSeek account. Do not paste a key. The old "create the provider account" row was trashed on purpose.

| Line | Result |
|---|---|
| Pass | `PASS` on the socket check. State = ON. Usage pool = DeepSeek via ProArt. |
| Fail | `FAIL down` and no existing unit. State = OFF. Note `no unit; left off`. |
| stuck_if | A unit name exists, start was run, and the socket is still down 30 minutes later. State = OFF. Do not ask Nick. |

DeepSeek is used only when this socket is up **and** Cursor usage is gone. It is not the default.

### B5. Kavi — bridge folders

On the machine where the bridge folder is already synced (the Mac, after step 2). The directory comes from `AGENT_OFFICE_KAVI_BRIDGE_DIR` on that machine. Do not print the path. Do not print file names.

```bash
if [ -n "$AGENT_OFFICE_KAVI_BRIDGE_DIR" ] \
  && [ -d "$AGENT_OFFICE_KAVI_BRIDGE_DIR/to-george" ] \
  && [ -d "$AGENT_OFFICE_KAVI_BRIDGE_DIR/to-kavi" ] \
  && [ ! -L "$AGENT_OFFICE_KAVI_BRIDGE_DIR/to-george" ] \
  && [ ! -L "$AGENT_OFFICE_KAVI_BRIDGE_DIR/to-kavi" ]; then
  echo PASS
else
  echo FAIL
fi
```

| Line | Result |
|---|---|
| Pass | `PASS`. Write one heartbeat file into `to-george` whose body is the single line `bridge up <UTC time>`. No other text. |
| Fail | `FAIL`. Crew Status **Mac** stays OFF if the desktop is up but the folder is missing: set Mac = ON and Note `bridge dir missing`. Work Queue **WQ-7** Status = Blocked. |
| stuck_if | `FAIL` 30 minutes after Nick's step 2, or WQ-7's existing timer (2026-10-25 12:00 MT / 18:00 UTC) if the Mac is still off. If the Mac is off, set WQ-7 to Blocked with next action `wait for Mac wake`. Do not ask Nick. |

Do not read packet bodies. Do not open Major Files. Do not install a connector.

### B6. Kavi — WQ-7, open bridge issues

Row: Work Queue **WQ-7**, "File open bridge issues on Work Queue", Lane Kavi, Status Routed.

After B5 Pass, for each still-open bridge issue, add one Work Queue row:

| Property | Value |
|---|---|
| Task | Short title only |
| Type | Issue |
| Status | Inbox |
| Lane | Kavi, or the lane that already owns it |
| Next action | The next action in one line |
| Stuck if no update by | 24 hours from the row's create time |
| Link | A Drive or GitHub link that is not under Major Files |
| Source | Kavi bridge |

No body, no dollar amount, no account number, no student data. If the only copy of an item is under Major Files, skip it.

| Line | Result |
|---|---|
| Pass | WQ-7 Status = Done, and every new row matches the table above. Zero open bridge issues is a pass: set WQ-7 Done and Note `0 open`. |
| Fail | A row contains a body, a secret, or a Major Files link. Dan trashes that row. Kavi does not repaste it. |
| stuck_if | WQ-7 still Routed at 2026-10-25 12:00 MT and the Mac desktop has been up for 30 minutes. Set Blocked. Do not ask Nick. |

### B7. ForgeL — GitHub issues

On the ProArt, after B2 Pass, in the office checkout he already uses:

```bash
gh issue list --state open --limit 50 --json number,title
```

| Line | Result |
|---|---|
| Pass | Exit 0 and a JSON array. For each number that has no Work Queue link yet, add Type = Issue, Lane = ForgeL, Task = the title, Link = the issue URL, Stuck if no update by = 7 days, Source = Lane. |
| Fail | `gh not logged in`, `gh not found`, or a non-zero exit. Crew Status **agent-office** Note = that short phrase. Do not run `gh auth login`. |
| stuck_if | No pass or fail line 30 minutes after B2 Pass. Note `gh check missing`. Do not ask Nick. |

Do not merge. Do not force-push. Do not enable auto-merge.

### B8. Dan — forbidden-data read

Read titles, notes, and links on Needs Nick, Work Queue, Crew Status, and Life Admin. Do not copy row text into git.

| Line | Result |
|---|---|
| Pass | Zero rows contain a secret, token, password, account or card number, student data, Major Files content, or a crew-router or ProArt address. Note `KS1 pass` on Dan's Crew Status row. |
| Fail | Trash the offending row in Notion. Do not quote it. Note `KS1 fail, row trashed`. |
| stuck_if | No pass or fail 30 minutes after B6 and B7 have a pass or a fail. |

### B9. Cursor — heartbeats

Cursor updates Crew Status. Grok Bot does not.

Set Last heartbeat = now and Heartbeat every min = 30 on every row whose State is ON. Leave OFF, Parked, and Excluded rows without a fake heartbeat. Set Unknown lanes that did not run (none of Jack, Kavi, ForgeL, Dan, george, Cursor) to the state that owner just proved. TutorL stays Excluded. Side Lanes stay Parked. Grok Bot stays Parked.

| Line | Result |
|---|---|
| Pass | Every ON row has Last heartbeat within the last 30 minutes. |
| Fail | A heartbeat was written by Grok Bot, or an OFF row was painted ON. Revert that edit. |
| stuck_if | No heartbeat write 30 minutes after B2 Pass. The running Cursor lane writes `usage-exhausted at B9` on Cursor's Note if usage is gone, then stops. |

### B10. george — route only

Read Needs Nick, view **Awaiting**.

| Line | Result |
|---|---|
| Pass | The view has 0 rows. george writes nothing else. |
| Fail | The view has a row. george does not text Nick during this home open. He sets that row's status only if he is recording a quote Nick already gave. He does not write a task body. |
| stuck_if | He has not read the view 30 minutes after B9 Pass. Cursor reads it and notes the count. |

## Done

Nick's steps: 2. Bot chain B1–B10 has a pass or a recorded fail on Crew Status. WQ-7 is Done or Blocked. Grok Bot is still Parked.
