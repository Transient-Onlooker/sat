@echo off
setlocal
title SE3C Satellite Dashboard
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting Vite dev server...
call npm.cmd run dev

if errorlevel 1 (
  echo The dev server exited with an error.
  pause
)
