@echo off
setlocal
cd /d "%~dp0"

echo.
echo Starting quarry rope tracker...
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found.
  echo Install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing packages...
  call npm install
  if errorlevel 1 goto error
)

echo Preparing database...
call npm run db:push
if errorlevel 1 goto error

call npm run db:seed
if errorlevel 1 goto error

echo.
echo App is starting.
echo Computer: http://localhost:3000
echo Phone:    http://192.168.0.33:3000
echo.
echo Keep this window open.
echo.
call npm run dev -- -H 0.0.0.0
goto end

:error
echo.
echo Something went wrong. Send a screenshot of this window.
pause

:end
endlocal
