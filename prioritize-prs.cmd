@echo off
setlocal
set SCRIPT_DIR=%~dp0

if not exist "%SCRIPT_DIR%dist\index.js" (
  echo dist\index.js not found. Run "npm run build" first.
  exit /b 1
)

node "%SCRIPT_DIR%dist\index.js" %*
