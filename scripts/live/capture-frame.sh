#!/usr/bin/env bash
# One near-live desk frame for THIS bot's own display. Fails closed: any doubt -> no frame.
# Config (env):
#   AO_LIVE_SEAT       seat id, e.g. seat-3 (required)
#   AO_LIVE_DISPLAY    this bot's own X display, e.g. :5 (required; never the ProArt, never another bot's)
#   AO_LIVE_WORKING    must be "1": the caller only runs this while the seat is WORKING
#   AO_LIVE_OUTBOX     directory for the outbox file (default /workspace/live-outbox), uploaded over
#                      Bridge/live/<seat>.jpg by the bot's own Drive connector call. No tunnel, no HTTP.
# Cadence: the caller runs this at most once every 10-30 s, only while WORKING.
# Exit 0 = frame written/sent, 3 = skipped on purpose, other = error.
set -euo pipefail
umask 077
MAX=$((400 * 1024))
seat="${AO_LIVE_SEAT:-}"; disp="${AO_LIVE_DISPLAY:-}"
[[ "$seat" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]] || { echo "skip: bad seat" >&2; exit 3; }
[[ "$disp" =~ ^:[0-9]+$ ]] || { echo "skip: bad display" >&2; exit 3; }
[[ "${AO_LIVE_WORKING:-0}" == "1" ]] || { echo "skip: not WORKING" >&2; exit 3; }
command -v import >/dev/null && command -v convert >/dev/null || { echo "skip: ImageMagick missing" >&2; exit 3; }
command -v xdotool >/dev/null || { echo "skip: xdotool missing" >&2; exit 3; }

# Sensitive-page check from the active window title. Unknown title = skip.
title="$(DISPLAY="$disp" timeout 3 xdotool getactivewindow getwindowname 2>/dev/null || true)"
[[ -n "$title" ]] || { echo "skip: no active window title" >&2; exit 3; }
if grep -Eiq 'sign[ -]?in|log[ -]?in|password|passcode|2-?step|verif|otp|one[- ]time|auth|oauth|account|credential|token|secret|api key|card|payment|checkout|billing|wallet|bank|paypal|stripe|1password|bitwarden|keychain|major files' <<<"$title"; then
  echo "skip: sensitive window" >&2; exit 3
fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
DISPLAY="$disp" timeout 10 import -silent -window root -display "$disp" "$tmp/raw.png"
q=70
for size in 1280x800 1024x640 800x500; do
  convert "$tmp/raw.png" -resize "${size}>" -strip -quality "$q" "$tmp/f.jpg"
  [[ $(stat -c %s "$tmp/f.jpg") -le $MAX ]] && break
  q=55
done
[[ $(stat -c %s "$tmp/f.jpg") -le $MAX ]] || { echo "skip: frame over 400 KB" >&2; exit 3; }
# Re-check the title after capture: if it changed to something sensitive, drop the frame.
title2="$(DISPLAY="$disp" timeout 3 xdotool getactivewindow getwindowname 2>/dev/null || true)"
[[ "$title2" == "$title" ]] || { echo "skip: window changed during capture" >&2; exit 3; }

out="${AO_LIVE_OUTBOX:-/workspace/live-outbox}"; mkdir -p "$out"
# One file per seat, replaced in place (never a new file per frame).
mv -f "$tmp/f.jpg" "$out/.$seat.jpg.part" && mv -f "$out/.$seat.jpg.part" "$out/$seat.jpg"
