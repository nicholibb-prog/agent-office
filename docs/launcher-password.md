# Launcher: start the office without `--password` on the command line

`--password <value>` is visible to any process listing (Task Manager, `wmic`, `ps`).
The kit's `start-office.cmd` should hand the password over through a file (preferred)
or the environment. The server checks `AGENT_OFFICE_PASSWORD`, then
`AGENT_OFFICE_PASSWORD_FILE`, then the deprecated `--password` flag, and never prints the value.

## One-time setup (owner-only file)

```bat
mkdir "%LOCALAPPDATA%\agent-office" 2>nul
rem Type the password into the file yourself; don't put it in this script.
notepad "%LOCALAPPDATA%\agent-office\password.txt"
rem Owner-only: drop inherited permissions, grant only the current user.
icacls "%LOCALAPPDATA%\agent-office\password.txt" /inheritance:r /grant:r "%USERNAME%:F"
```

## start-office.cmd (password file)

```bat
@echo off
setlocal
set "AGENT_OFFICE_PASSWORD_FILE=%LOCALAPPDATA%\agent-office\password.txt"
rem No --password here: nothing secret on the command line.
node "%LOCALAPPDATA%\agent-office\app\dist\server\cli.js" --no-open %*
endlocal
```

## start-office.cmd (environment variable)

Only if the variable is already set for the user account (for example with
`setx AGENT_OFFICE_PASSWORD ...` typed once by the owner, never stored in the script):

```bat
@echo off
setlocal
if not defined AGENT_OFFICE_PASSWORD (
  echo AGENT_OFFICE_PASSWORD is not set; see docs/launcher-password.md
  exit /b 1
)
node "%LOCALAPPDATA%\agent-office\app\dist\server\cli.js" --no-open %*
endlocal
```

Notes:
- Never `echo` the password or the file's contents in the launcher.
- Files under `Documents\Major Files` are refused.
- Paths above are placeholders; adjust `app\dist\server\cli.js` to wherever the kit installs the office.
