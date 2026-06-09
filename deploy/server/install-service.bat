@echo off
REM ============================================================
REM  Alpha Ticket Manager - SERVER install as Windows Service
REM  (Windows Task Scheduler, runs as SYSTEM at boot, auto-restart)
REM  Messages in English on purpose (ASCII) to avoid codepage issues.
REM ============================================================
setlocal EnableExtensions
title Alpha Ticket Manager - Server Service Installer
cd /d "%~dp0"

REM --- admin elevation ---
if "%~1"=="ELEVATED" goto MAIN
net session >nul 2>nul
if errorlevel 1 (
    powershell -Command "Start-Process '%~f0' -ArgumentList 'ELEVATED' -Verb RunAs"
    exit /b
)
:MAIN

REM === settings ===
set "TASK_NAME=AlphaTicketManagerService"
set "PORT=3001"
set "NODE_VER=v22.11.0"
set "NODE_MSI_NAME=node-v22-x64.msi"

REM App root = two levels up from deploy\server  (this .bat lives in <root>\deploy\server)
pushd "%~dp0..\.." & set "APP_ROOT=%CD%" & popd
echo [OK] App root: %APP_ROOT%
echo.

REM === [1/5] Node.js >= 22 (required for node:sqlite) ===
echo [1/5] Checking Node.js (>= 22 required)...
set "NODE_EXE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if "%NODE_EXE%"=="" (
    for /f "delims=" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
)
set "NODE_OK="
if defined NODE_EXE (
    for /f "tokens=1 delims=." %%v in ('"%NODE_EXE%" -p "process.versions.node" 2^>nul') do if %%v GEQ 22 set "NODE_OK=1"
)
if defined NODE_OK goto NODE_READY

echo [MISSING] Node.js 22+ not found. Will download %NODE_VER% (~30 MB).
choice /C YN /M "Continue with download and silent install"
if errorlevel 2 exit /b 1
set "NODE_MSI=%~dp0%NODE_MSI_NAME%"
if exist "%NODE_MSI%" goto INSTALL_NODE
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/%NODE_VER%/node-%NODE_VER%-x64.msi' -OutFile '%NODE_MSI%' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto NODE_DL_FAIL
:INSTALL_NODE
echo [Install] Node.js silent install...
msiexec /i "%NODE_MSI%" /quiet /qn /norestart ADDLOCAL=ALL
if errorlevel 1 goto NODE_INSTALL_FAIL
set "PATH=%ProgramFiles%\nodejs;%PATH%"
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
:NODE_READY
echo [OK] Node: %NODE_EXE%
set "PATH=%ProgramFiles%\nodejs;%PATH%"
echo.

REM === [2/5] Compiled build + dependencies ===
echo [2/5] Build ^& dependencies...
if exist "%APP_ROOT%\server\dist\server.js" goto HAVE_BUILD
echo [..] No compiled build -> building from source (needs internet, one-off)...
pushd "%APP_ROOT%"
call npm install --no-audit --no-fund
if not exist "%APP_ROOT%\client\dist\index.html" call npm run build
call npm run build --workspace server
call npm prune --omit=dev
popd
goto BUILD_OK
:HAVE_BUILD
if exist "%APP_ROOT%\node_modules" goto BUILD_OK
echo [..] Installing runtime dependencies (npm install --omit=dev)...
pushd "%APP_ROOT%"
call npm install --omit=dev --no-audit --no-fund
popd
:BUILD_OK
echo [OK] Build ^& dependencies ready (runtime: node dist\server.js).
echo.

REM === [3/5] First-run database seed (basic data, no movements) ===
echo [3/5] Database...
if exist "%APP_ROOT%\data\ticket.db" (
    echo [OK] Existing database found - left untouched.
) else (
    echo [..] Creating fresh database with defaults (seed)...
    pushd "%APP_ROOT%"
    call npm run seed
    popd
    echo [OK] Database seeded (admin/admin, default ticket types, no sales).
)
echo.

REM === [4/5] Firewall rule for the LAN port ===
echo [4/5] Firewall rule for TCP %PORT%...
netsh advfirewall firewall delete rule name="AlphaTicketManager" >nul 2>nul
netsh advfirewall firewall add rule name="AlphaTicketManager" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>nul
echo [OK] Firewall rule added (inbound TCP %PORT%).
echo.

REM === [5/5] Service via Task Scheduler ===
echo [5/5] Installing service (Task Scheduler, SYSTEM, onstart)...
schtasks /delete /tn %TASK_NAME% /f >nul 2>nul

REM auto-restart wrapper (runs the compiled server directly - no tsx/npm at runtime)
> "%~dp0_service-wrapper.bat" (
  echo @echo off
  echo set "PATH=%ProgramFiles%\nodejs;%%PATH%%"
  echo cd /d "%APP_ROOT%"
  echo :LOOP
  echo node "%APP_ROOT%\server\dist\server.js" ^>^> "%APP_ROOT%\data\server.log" 2^>^&1
  echo timeout /t 5 /nobreak ^>nul
  echo goto LOOP
)

schtasks /create /tn %TASK_NAME% /tr "\"%~dp0_service-wrapper.bat\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 goto TASK_FAIL
schtasks /run /tn %TASK_NAME%
timeout /t 4 /nobreak >nul

REM admin auto-open shortcut (this PC)
set "STARTUP=%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp"
> "%STARTUP%\Alpha Ticket Manager (Admin).url" (
  echo [InternetShortcut]
  echo URL=http://localhost:%PORT%/
)

echo.
echo ============================================================
echo   DONE - Server service installed and started.
echo ============================================================
echo   URL (this PC):     http://localhost:%PORT%/
echo   URL (other PCs):   http://THIS-PC-IP:%PORT%/
echo   Tools: manage-service.bat / un