@echo off
REM ============================================================
REM  Deploy ALL Supabase Edge Functions to the linked project.
REM  Run from the "online" folder (where the "supabase" dir lives).
REM
REM  One-time prerequisites:
REM    npm i -g supabase
REM    supabase login
REM    supabase link --project-ref YOUR-NEW-PROJECT-REF
REM
REM  Then just run this file. config.toml sets verify_jwt=false on public functions.
REM ============================================================
setlocal
title Supabase - Deploy Edge Functions
cd /d "%~dp0"

where supabase >nul 2>nul || (echo [ERROR] Supabase CLI not found. Run: npm i -g supabase  ^&  supabase login ^& supabase link --project-ref ^<ref^> & pause & exit /b 1)

echo Deploying all Edge Functions...
supabase functions deploy
if errorlevel 1 (
  echo.
  echo [INFO] If your CLI is older and needs per-function deploy, run:
  echo   supabase functions deploy create-order
  echo   supabase functions deploy resume-order
  echo   supabase functions deploy order-status
  echo   supabase functions deploy viva-webhook
  echo   supabase functions deploy lead
  echo   supabase functions deploy ticket
  echo   supabase functions deploy wallet-google
)
echo.
echo Done. Next: set Function Secrets (see cheat sheet) and the Viva webhook URL.
pause
