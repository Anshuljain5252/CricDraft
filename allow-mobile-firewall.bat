@echo off
setlocal
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="CricDraft Live" >nul 2>&1
netsh advfirewall firewall add rule name="CricDraft Live" dir=in action=allow protocol=TCP localport=3000 profile=private
echo Done. CricDraft port 3000 is allowed on Private networks.
pause
