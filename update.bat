@echo off
setlocal
cd /d "%~dp0"
title Update portfolio works
call tools\ensure_tools.bat || (pause & exit /b)
py -3 tools\build_site.py
echo.
pause
