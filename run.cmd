@echo off
REM Double-click to run Joggl from source. Installs dependencies on first use.
REM For an installed copy with a Start-menu entry, run: npm run dist

cd /d "%~dp0"

if not exist "node_modules\.bin\electron.cmd" (
  echo Installing dependencies. This only happens once, and takes a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed - see the messages above.
    pause
    exit /b 1
  )
  echo.
)

echo Starting Joggl. Closing this window quits the app.
echo.
call "node_modules\.bin\electron.cmd" .

REM Only pause on a crash, so a normal quit closes the window.
if errorlevel 1 (
  echo.
  echo Joggl exited with an error. The log is in logs\joggl.log
  pause
)
