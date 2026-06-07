@echo off
REM ============================================================
REM  Alpha Ticket Manager - manual start (debugging, no service)
REM  Shows live console output. Ctrl+C to stop.
REM ============================================================
setlocal EnableExtensions
title Alpha Ticket Manager - Manual Start
pushd "%~dp0..\.." & set "APP_ROOT=%CD%" & popd
set "PATH=%ProgramFiles%\nodejs;%PATH%"
cd /d "%APP_ROOT%"
echo App root: %APP_ROOT%
echo Starting (http://localhost:3001/) ... Ctrl+C to stop.
echo.
call npm start
pause
