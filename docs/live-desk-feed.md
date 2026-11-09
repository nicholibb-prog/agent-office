# Live desk-screen feed

While a seat is **WORKING**, its desk screen can show that bot's own VM desktop, live. Idle screens never change.

## How it works
- The bot pushes its own frames: `POST /api/bridge/live-frame` with its **seat token** (`x-bridge-token`), body `{"mime":"image/jpeg|image/png|image/webp","data":"<base64>"}`. The seat is taken from the token; any seat or name in the body is ignored.
- A person signed in to the office turns a seat on: `POST /api/live/seat {"seat":"seat-a","on":true}`. **Every seat is off by default**, and turning it off drops the frame being held.
- The office page reads `GET /api/live/seats` and `GET /api/live/frame/<seat>`. Both need a signed-in office session. Seat tokens can't use them.
- A working seat with no frame, or with a frame older than 10 s, shows **no live feed**. The painted desktop is never passed off as a live view. A real frame carries a red **● LIVE** badge.

## Security rules
- There is no new listener. Everything goes through the existing 127.0.0.1 office server with the bridge Host and Origin checks. No VNC or RDP is used, and the office never fetches a frame from any URL.
- Frames are kept in memory only. They are never written to disk or logged.
- Caps: 400 KB per frame (decoded) and at most 4 frames a second per seat. Each frame's bytes must really be a JPEG, PNG or WebP.
- **Masking is not done by the office.** It can't see inside a picture. The **source bot must not send** frames that show password, token or secret fields. It must never capture the ProArt's own screen, and never anything from Major Files.

## Timeout
- A sticky WORKING ends on a real idle or done signal, or after `AO_WORKING_TIMEOUT_MS` (default 900000 = 15 min) with no fresh push.
