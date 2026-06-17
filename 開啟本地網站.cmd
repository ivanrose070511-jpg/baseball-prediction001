@echo off
cd /d "%~dp0"
start "" "http://localhost:4173/"
"C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "%~dp0scripts\local-server.mjs"
pause
