@echo off
REM ============================================================
REM  Alpha Ticket Manager - CLIENT station launcher installer
REM  Creates a kiosk/app browser shortcut (Chrome -> Edge) to the
REM  server, on the Desktop and in Startup (auto-open at login).
REM  No Node here - the station is just a browser pointing to the server.
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
title Alpha Ticket Manager - Station Setup
cd /d "%~dp0"

echo ============================================================
echo   Alpha Ticket Manager - Station (Tameio / Elenktis) setup
echo ============================================================
echo.
set "SERVER_IP="
set /p "SERVER_IP=Server IP or hostname (e.g. 192.168.1.10): "
if "%SERVER_IP%"=="" echo [ERROR] Server IP is required. & pause & exit /b 1
set "PORT=3001"
set /p "PORT=Server port [3001]: "
if "%PORT%"=="" set "PORT=3001"
echo.
echo Role:  1) Tameio (cashier)   2) Elenktis (checker)
choice /C 12 /N /M "Choose role (1-2): "
if errorlevel 2 ( set "ROLE=Elenktis" ) else ( set "ROLE=Tameio" )
set "STATION="
set /p "STATION=Station name (optional, e.g. TAMEIO 1): "
echo.

set "URL=http://%SERVER_IP%:%PORT%/"

REM --- detect browser: Chrome first, then Edge ---
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER echo [ERROR] Neither Chrome nor Edge found. & pause & exit /b 1
echo [OK] Browser: %BROWSER%

REM App mode (own window, no tabs). Each role uses its own profile dir so logins persist separately.
set "PROFILE=%LocalAppData%\AlphaTM\%ROLE%"
set "ARGS=--app=%URL% --start-maximized --user-data-dir=\"%PROFILE%\""

set "NAME=Alpha TM - %ROLE%"
set "STARTUP=%AppData%\Microsoft\Windows\Start Menu\Programs\Startup"
set "DESKTOP=%UserProfile%\Desktop"

powershell -NoProfile -Command ^
  "$w=New-Object -ComObject WScript.Shell;" ^
  "foreach($p in @('%STARTUP%\%NAME%.lnk','%DESKTOP%\%NAME%.lnk')){" ^
  " $s=$w.CreateShortcut($p); $s.TargetPath='%BROWSER%'; $s.Arguments='%ARGS%';" ^
  " $s.IconLocation='%BROWSER%'; $s.WorkingDirectory=Split-Path '%BROWSER%'; $s.Save() }"

echo.
echo ============================================================
echo   DONE - Station configured.
echo ============================================================
echo   Role:     %ROLE%   %STATION%
echo   Opens:    %URL%
echo   Shortcut: Desktop + Startup ("%NAME%")
echo.
echo   Tip: at first launch pick the role ("Os Tamias" / "Os Elenktis")
echo        and the station from the top-right selector; the browser
echo        profile remembers it for next time.
echo.
choice /C YN /M "Open the station now"
if errorlevel 2 goto END
start "" "%BROWSER%" %ARGS%
:END
pause
