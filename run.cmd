@echo off
REM Double-click to run Joggl. Nothing needs to be installed first — the launcher
REM fetches a portable Node into .node\ on first use if there isn't one on PATH.
REM
REM The work is in scripts\launch.ps1; batch cannot verify a checksum sensibly.
REM For an installed copy with a Start-menu entry, run: npm run dist

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launch.ps1" %*

REM Only pause on a failure, so a normal quit closes the window.
if errorlevel 1 (
  echo.
  echo Joggl exited with an error. The log is in logs\joggl.log
  pause
)
