@echo off
rem Builds Windows installers (Setup.exe) for OK apps.
rem   build-setup.bat              -> all apps (OKpass, OKfetch, OKgram)
rem   build-setup.bat OKfetch      -> one app (several names allowed)
rem Result: Setup\<App>-Setup.exe next to this file (versioned copy stays in the app's dist folder).
rem The installer contains Electron, so people installing the app need nothing else.
rem Building needs Node.js 20+ on this PC; if it is missing, this script offers to install it via winget.
setlocal EnableExtensions
set "ROOT=%~dp0"
set "OUT=%ROOT%Setup"
set "FAILED="
set "BUILT="

call :ensure_node || goto :end

if "%~1"=="" (set "APPS=OKpass OKfetch OKgram") else (set "APPS=%*")
for %%A in (%APPS%) do call :build %%A

echo.
echo ==========================================================
if defined BUILT echo  Hotovo:%BUILT%
if defined BUILT echo  Instalacky jsou ve slozce: %OUT%
if defined FAILED echo  CHYBA pri sestaveni:%FAILED%
echo ==========================================================
if defined BUILT if not defined OK_NO_PAUSE explorer "%OUT%"
goto :end


:build
set "APP=%~1"
set "DIR=%ROOT%%APP%\%APP% - WinLinMac"
echo.
echo ==========================================================
echo  %APP%
echo ==========================================================
if not exist "%DIR%\package.json" (
  echo Slozka aplikace nenalezena: %DIR%
  set "FAILED=%FAILED% %APP%"
  exit /b 1
)
pushd "%DIR%"

echo [1/3] Instaluji zavislosti ^(npm install^)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :build_fail

echo [2/3] Sestavuji instalacku ^(npm run dist:win^)...
if exist "dist\%APP%-Setup-*.exe" del /q "dist\%APP%-Setup-*.exe"
call npm run dist:win
if errorlevel 1 goto :build_fail

echo [3/3] Kopiruji do %OUT%
set "SETUP="
for %%F in ("dist\%APP%-Setup-*.exe") do set "SETUP=%%~fF"
if not defined SETUP (
  echo Sestaveni probehlo, ale v dist chybi %APP%-Setup-*.exe
  goto :build_fail
)
if not exist "%OUT%" mkdir "%OUT%"
copy /y "%SETUP%" "%OUT%\%APP%-Setup.exe" >nul
if errorlevel 1 goto :build_fail
for %%F in ("%SETUP%") do echo Hotovo: %OUT%\%APP%-Setup.exe  ^(%%~nxF^)
set "BUILT=%BUILT% %APP%"
popd
exit /b 0

:build_fail
popd
set "FAILED=%FAILED% %APP%"
exit /b 1


:ensure_node
where node >nul 2>nul && goto :check_node_version
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
  goto :check_node_version
)
echo Node.js neni nainstalovany. Je potreba jen pro sestaveni instalacky na tomto PC.
where winget >nul 2>nul || (
  echo Stahni a nainstaluj Node.js LTS z https://nodejs.org a spust tento soubor znovu.
  exit /b 1
)
choice /c AN /m "Nainstalovat Node.js LTS pres winget"
if errorlevel 2 (
  echo Stahni Node.js LTS z https://nodejs.org a spust tento soubor znovu.
  exit /b 1
)
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
where node >nul 2>nul || (
  echo Node.js se nepodarilo najit. Zavri okno, otevri ho znovu a spust tento soubor znovu.
  exit /b 1
)

:check_node_version
set "NODE_MAJOR="
for /f "tokens=1 delims=v." %%V in ('node -v') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo Nepodarilo se zjistit verzi Node.js.
  exit /b 1
)
if %NODE_MAJOR% LSS 20 (
  echo Je potreba Node.js 20 nebo novejsi, nainstalovana je verze %NODE_MAJOR%. Aktualizuj z https://nodejs.org
  exit /b 1
)
for /f "delims=" %%V in ('node -v') do echo Node.js %%V
exit /b 0


:end
if not defined OK_NO_PAUSE pause
if defined FAILED exit /b 1
exit /b 0
