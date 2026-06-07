@echo off
REM Wrapper for new-customer.ps1 (factory build of a customer SERVER package).
REM Edit the values below and run, or call the .ps1 directly with your own params.
setlocal
title Alpha Ticket Manager - New Customer Package
cd /d "%~dp0"

set "CUSTOMER=Demo Pelatis"
set "VAT=000000000"
set "CITY="
set "LOGO="
set "OUT=%UserProfile%\Desktop\AlphaTM-builds"

echo Building package for: %CUSTOMER%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0new-customer.ps1" -Customer "%CUSTOMER%" -Vat "%VAT%" -City "%CITY%" -Logo "%LOGO%" -Out "%OUT%"
echo.
pause
