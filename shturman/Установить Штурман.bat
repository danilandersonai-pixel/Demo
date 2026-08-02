@echo off
chcp 65001 >nul
setlocal
title Штурман — установка
cd /d "%~dp0"

echo.
echo   Штурман — установка
echo   ===================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set MAJOR=%%v
if not defined MAJOR goto no_node
if %MAJOR% LSS 18 goto old_node

node "install\install.js" %*
set STATUS=%errorlevel%
echo.
echo   Это окно можно закрыть.
pause >nul
exit /b %STATUS%

:no_node
echo   На этом компьютере не хватает одной программы — Node.js.
echo   Это бесплатная и безопасная штука, на которой работает Штурман.
echo.
echo   Сейчас откроется страница загрузки. Скачайте версию с пометкой LTS,
echo   установите её обычным способом и запустите этот файл ещё раз.
echo.
start "" "https://nodejs.org/ru/download"
echo   Окно можно закрыть.
pause >nul
exit /b 0

:old_node
echo   Node.js на компьютере старой версии.
echo   Штурману нужна 18-я или новее.
echo.
echo   Сейчас откроется страница загрузки — поставьте свежую версию
echo   и запустите этот файл ещё раз.
echo.
start "" "https://nodejs.org/ru/download"
echo   Окно можно закрыть.
pause >nul
exit /b 0
