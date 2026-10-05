@echo off
rem Start OKgram from source (Windows). Needs Node.js 20 or newer.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js neni nainstalovany: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Instaluji zavislosti...
  call npm install || (pause & exit /b 1)
)
call npm run dev
