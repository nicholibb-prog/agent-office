# Launcher: start the office without `--password` on the command line

`--password <value>` is visible to any process listing (Task Manager, `wmic`, `ps`).
The kit's `start-office.cmd` should hand the password over through an owner-only file.
Don't use `setx` for it: that stores the password in plain text in the registry. The server checks `AGENT_OFFICE_PASSWORD`, then
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

Notes:
- The office removes `AGENT_OFFICE_PASSWORD` and `AGENT_OFFICE_PASSWORD_FILE` from its environment
  once read, so child processes don't inherit them.
- Never `echo` the password or the file's contents in the launcher.
- Files under `Documents\Major Files` are refused.
- Paths above are placeholders; adjust `app\dist\server\cli.js` to wherever the kit installs the office.
