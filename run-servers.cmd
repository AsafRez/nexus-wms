@echo off
start "WMS-Backend" cmd /k "cd /d %~dp0backend && npm run start:dev"
start "WMS-Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

