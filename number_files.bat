@echo off
cd /d "%~dp0"
title Number media files
echo Renaming downloaded files in media\ to 1, 2, 3... in download order:
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\number_media_files.ps1"
echo.
pause
