@echo off
REM ============================================================
REM  Alpha Ticket Manager - SERVER manage (start/stop/restart/status)
REM ============================================================
setlocal EnableExtensions
title Alpha Ticket Manager - Manage Service
cd /d "%~dp0"

if "%~1"=="ELEVATED" goto MAIN
net session >nul 2>nul
if errorlevel 1 (
    powershell -Command "Start-Process '%~f0' -ArgumentList 'ELEVATED' -Verb RunAs"
    exit /b
)
:MAIN
set "TASK_NAME=AlphaTicketManagerService"
set "PORT=3001"

:MENU
cls
echo ============================================================
echo   Alpha Ticket Manager - Manage Service
echo ============================================================
echo   1. Start
echo   2. Stop
echo   3. Restart
echo   4. Status / diagnostics
echo   5. Exit
echo.
choice /C 12345 /N /M "Choose (1-5): "
if errorlevel 5 exit /b 0
if errorlevel 4 goto STATUS
if errorlevel 3 goto RESTART
if errorlevel 2 goto STOP
if errorlevel 1 goto START

:START
schtasks /run /tn %TASK_NAME%
echo [OK] Started.
pause & goto MENU

:STOP
schtasks /end /tn %TASK_NAME% >nul 2>nul
taskkill /F /IM node.exe >nul 2>nul
echo [OK] Stopped.
pause & goto MENU

:RESTART
schtasks /end /tn %TASK_NAME% >nul 2>nul
taskkill /F /IM node.exe >nul 2>nul
timeout /t 2 /nobreak >nul
schtasks /run /tn %TASK_NAME%
echo [OK] Restarted.
pause & goto MENU

:STATUS
echo.
echo [Task]
schtasks /query /tn %TASK_NAME% /v /fo LIST 2>nul | findstr /R "Status: Last"
echo.
echo [node.exe]
tasklist /fi "imagename eq node.exe" | findstr /i node.exe || echo   none running
echo.
echo [Port %PORT%]
netstat -ano | findstr ":%PORT%" | findstr LISTENING || echo   not listening
echo.
pause & goto MENU
