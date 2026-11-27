@echo off
cd /d "%~dp0"
set EXT=..\toppay-ext
if not exist "%EXT%\manifest.json" set /p EXT=Extension folder path (jekhane manifest.json ache): 
python tools\publish_ext.py "%EXT%"
if errorlevel 1 py tools\publish_ext.py "%EXT%"
git add .
git commit -m "extension update"
git push
pause
