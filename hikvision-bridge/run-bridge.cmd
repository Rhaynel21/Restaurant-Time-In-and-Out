@echo off
REM Auto-restart launcher for the Qui Hikvision bridge.
REM Started at logon (hidden) by start-bridge.vbs via Task Scheduler.
cd /d "%~dp0"
if not exist logs mkdir logs

:loop
echo ---- bridge starting %DATE% %TIME% ---->> "logs\bridge.log"
"C:\Program Files\nodejs\node.exe" src\index.js >> "logs\bridge.log" 2>&1
echo ---- bridge exited (code %ERRORLEVEL%) %DATE% %TIME%, restarting in 5s ---->> "logs\bridge.log"
timeout /t 5 /nobreak > nul
goto loop
