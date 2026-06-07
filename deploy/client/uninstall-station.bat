@echo off
REM ============================================================
REM  Alpha Ticket Manager - remove station shortcuts
REM ============================================================
setlocal EnableExtensions
title Alpha Ticket Manager - Remove Station
set "STARTUP=%AppData%\Microsoft\Windows\Start Menu\Programs\Startup"
set "DESKTOP=%UserProfile%\Desktop"
del /q "%STARTUP%\Alpha TM - Tameio.lnk"   >nul 2>nul
del /q "%STARTUP%\Alpha TM - Elenktis.lnk" >nul 2>nul
del /q "%DESKTOP%\Alpha TM - Tameio.lnk"   >nul 2>nul
del /q "%DESKTOP%\Alpha TM - Elenktis.lnk" >nul 2>nul
echo [OK] Station shortcuts removed (browser profiles under %%LocalAppData%%\AlphaTM kept).
pause
