@echo off
setlocal
cd /d "%~dp0"
title Import Instagram export
call tools\ensure_tools.bat || (pause & exit /b)
if "%~1"=="" (
  echo.
  echo Drag your Instagram export .zip - or the unzipped folder - onto this file.
  echo.
  pause
  exit /b
)
py -3 tools\import_instagram.py "%~1"
if errorlevel 1 (pause & exit /b)
echo.
echo Making previews for the site...
py -3 tools\build_site.py
echo.
pause
