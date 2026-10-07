@echo off
cd /d "%~dp0"
echo ==============================================
echo      CRICDRAFT LOCAL - FREE WINDOWS SETUP
echo ==============================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js LTS, then run this file again.
  echo https://nodejs.org/
  pause
  exit /b 1
)
node --version
echo.
echo Setup complete. No npm packages and no OpenAI API key are required.
echo API cost: INR 0.
echo Double-click start-cricdraft.bat to play.
pause
