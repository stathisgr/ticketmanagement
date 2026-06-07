@echo off
REM ============================================================
REM  Alpha Ticket Manager - SERVER uninstall (keeps data/)
REM ============================================================
setlocal EnableExtensions
title Alpha Ticket Manager - Server Uninstall
cd /d "%~dp0"

if "%~1"=="ELEVATED" goto MAIN
net session >nul 2>nul
if errorlevel 1 (
    powershell -Command "Start-Process '%~f0' -ArgumentList 'ELEVATED' -Verb RunAs"
    exit /b
)
:MAIN
set "TASK_NAME=AlphaTicketManagerService"

echo Stopping and removing service...
schtasks /end /tn %TASK_NAME% >nul 2>nul
schtasks /delete /tn %TASK_NAME% /f >nul 2>nul

echo Stopping node processes from the service wrapper...
taskkill /F /IM node.exe >nul 2>nul

del /q "%~dp0_service-wrapper.bat" >nul 2>nul
del /q "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp\Alpha Ticket Manager (Admin).url" >nul 2>nul

echo Removing firewall rule...
netsh advfirewall firewall delete rule name="AlphaTicketManager" >nul 2>nul

echo.
echo [OK] Service removed. Database and settings under data\ were NOT deleted.
echo     (taskkill stopped all node.exe - mind other Node apps on this PC.)
echo.
pause
