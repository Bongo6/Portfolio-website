@echo off
rem Used by update.bat and import_instagram.bat: installs Python and ffmpeg
rem with winget the first time, if they aren't on this PC yet.
set "MISSING="
py -3 --version >nul 2>nul || (
  echo Python isn't installed yet - installing it now, this takes a minute...
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  set "MISSING=1"
)
where ffmpeg >nul 2>nul || (
  echo ffmpeg isn't installed yet - installing it now, this takes a minute...
  winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
  set "MISSING=1"
)
if defined MISSING (
  echo.
  echo Done installing. Close this window and run it again so Windows picks them up.
  exit /b 1
)
exit /b 0
