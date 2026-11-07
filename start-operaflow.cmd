@echo off
title OPERAFlow (local)
cd /d "%~dp0"
echo Starting OPERAFlow... keep this window open. Close it (or press Ctrl+C) to stop.
node scripts\start-local.mjs
pause
