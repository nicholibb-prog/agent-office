# Near-live desk screens through the Drive Bridge (option c, approved by Dan)

## Office side (ProArt)
- Set `AO_BRIDGE_LOCAL_DIR` to the **locally synced** Bridge folder. The office reads `<dir>/live/<seat>.jpg` from it.
  - The path is resolved with realpath and must stay inside `live/`. Symlinks are rejected.
  - Each file must be at most 400 KB and must really be a JPEG.
  - The office has no Drive token and makes no network call.
- The file is served from `GET /api/live/frame/<seat>`, behind the office session plus the Host and Origin checks, and only for seats switched on (`POST /api/live/seat`). **Every seat is off by default.**
- The desk shows a blue **near-live · updated Ns ago** badge.
- A file older than 60 s, or a missing one, shows **no live feed**.

## Sender side (box): `scripts/live/capture-frame.sh`
- It captures only the bot's own display (`AO_LIVE_DISPLAY=:N`), and only when `AO_LIVE_WORKING=1`.
- Cadence: at most one frame every 10–30 s, only while WORKING.
- It reads the active window title before and after the capture. It skips the frame when the title:
  - is empty or unknown
  - matches sign-in, password, verification, card, payment, token or secret wording, or "major files"
  - changed during the capture
- The frame is scaled down to 1280×800 or less and saved as a JPEG of at most 400 KB. A frame that can't be made small enough is skipped.
- Output: it atomically replaces `AO_LIVE_OUTBOX/<seat>.jpg`, one file per seat. The bot's own Google Drive connector call then overwrites `Bridge/live/<seat>.jpg` in place, using the existing file id. Never create one file per frame.
- It needs ImageMagick (`import`, `convert`) and `xdotool`. ImageMagick is now installed on the box (apt). The script reads the active window, or the focused window when there is no window manager; no title means skip.
- There is no tunnel and no HTTP transport. Never share the folder or link to it, and never capture the ProArt.

## What blocks automatic Drive upload
- A shell script can't call the Google Drive connector. The connector is only reachable as an agent tool call, and using it needs no new credential.
- Each upload is therefore one agent turn: 120–360 calls an hour per seat at a 10–30 s cadence. Each call is slow, costs tokens, and competes with the bot's real work.
- Cheapest honest option: the WORKING bot runs the capture and the overwrite between its own tool steps, at most every 30 s, and the desk says "no live feed" whenever it falls behind (more than 60 s old).
