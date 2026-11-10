@echo off
title Jegyterminal szerver
cd /d "%~dp0"
where node >nul 2>nul || (echo Nincs Node.js telepitve! Toltsd le: https://nodejs.org  (LTS) & pause & exit /b 1)
node server.js
pause
