# Tailscale on the crew machines

The office keeps listening on `127.0.0.1:4600`. Tailscale is how the Mac and the ProArt reach that listener. Nothing binds `0.0.0.0`. No auth key is written into git, Notion, or chat.

Jack does the ProArt. Kavi does the Mac. Each command runs in that machine's own logged-in session. Cursor records the Front Desk. This cloud host does not join the tailnet.

Nick's home steps stay the two power-ons. If Tailscale prints a login URL, that page is Tailscale's own prompt on that desktop. It is not a new home step and not a Needs Nick row. If `tailscale status` is already Running, there is no prompt.

## Pass and fail

| Line | Result |
|---|---|
| Pass | `BackendState` is `Running`. The machine's Crew Status note includes `tailscale Running`. Peer names, tailnet IPs, and the raw status JSON stay off the Front Desk and out of git. |
| Fail | `BackendState` is `NeedsLogin`. Put the login URL on that machine's Work Queue row Link only. Note `tailscale NeedsLogin`. Do not paste an auth key. |
| stuck_if | 30 minutes after that desktop is up, the note still has no `tailscale` word. |

The Crew Status row **Tailscale** goes ON only when both the ProArt note and the Mac note say `tailscale Running`. Until then it stays Unknown.

Serve stays off until the office listen check in [HOME-OPEN-CHECKLIST.md](HOME-OPEN-CHECKLIST.md) B2 prints `PASS`. After serve, run that listen check again. `FAIL wide-bind` means stop the wide listener and start the office with `--host 127.0.0.1`. Do not pass `--host 0.0.0.0`. `HOST` in the environment is ignored.

Do not run `deploy/provision.sh` for this. That script installs a server unit. The office start is the one B2 already names.

## ProArt — Jack

Hostname `proart`.

Linux:

```bash
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
sudo systemctl enable --now tailscaled
sudo tailscale up --hostname=proart --timeout=15m
```

Windows, in the logged-in session:

```powershell
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  winget install -e --id Tailscale.Tailscale --accept-package-agreements --accept-source-agreements
}
tailscale up --hostname=proart --timeout=15m
```

If `tailscale` is not found right after `winget`, open a new terminal in that same session and run the `up` line again.

Read state. Print the one word, not the JSON:

```bash
tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s); process.stdout.write(j.BackendState||"")})'
```

When that word is `Running` and B2 is `PASS`:

```bash
sudo tailscale serve --bg --yes --https=443 http://127.0.0.1:4600
```

On Windows, drop the `sudo`. If serve prints a page to turn on MagicDNS and HTTPS certificates, open that page in the same session. Then run serve again. On that same visit, disable key expiry for this machine on the Tailscale machines page so it stays on the tailnet.

Re-run the B2 listen check. Set the ProArt note so it includes `tailscale Running`.

## Mac — Kavi

Hostname `mac`.

```bash
TS=tailscale
if ! command -v tailscale >/dev/null 2>&1; then
  if [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
    TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
  else
    command -v brew >/dev/null 2>&1 || { echo 'tailscale app missing'; exit 1; }
    brew install --cask tailscale
    TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
  fi
fi
"$TS" up --hostname=mac --timeout=15m
```

If that script prints `tailscale app missing`, set the Mac note to those words and stop.

Same state check as the ProArt. When it prints `Running` and B2 is `PASS`:

```bash
"$TS" serve --bg --yes --https=443 http://127.0.0.1:4600
```

Same MagicDNS page and the same key-expiry visit, for the Mac only. Set the Mac note so it includes `tailscale Running`.

## What stays off

No auth key in a command, a file that gets committed, or a Front Desk property. No second tailnet. No Tailscale SSH flag. No serve of Okkin's port or the crew-router port. Those stay on `127.0.0.1` only.
