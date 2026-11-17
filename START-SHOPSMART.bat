@echo off
cd /d "%~dp0"
echo Installing packages...
call npm install
call npm run db:generate
echo Starting ShopSmart. Open http://localhost:5173
call npm run dev
pause
