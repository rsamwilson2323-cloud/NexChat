echo off
title NexChat Server
color 0A
cd /d "%~dp0"

echo.
echo  ============================================
echo   NexChat - Personal Chat App
echo  ============================================
echo.

node --version
echo.

if not exist "node_modules" (
    echo  Installing dependencies, please wait...
    echo.
    npm install
    echo.
    echo  Done! Starting server...
    echo.
)

if not exist "data" mkdir data
if not exist "public\media" mkdir public\media
if not exist "public\avatars" mkdir public\avatars

echo  Server running at: http://localhost:3000
echo  Press Ctrl+C to stop
echo.

start http://localhost:3000
node server.js

pause