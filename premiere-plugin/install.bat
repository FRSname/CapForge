@echo off
echo ============================================
echo  SubForge Subtitles — Premiere Pro Plugin
echo  Installation Script
echo ============================================
echo.

:: 1. Enable CEP Debug Mode (requires admin for some systems)
echo [1/2] Enabling CEP debug mode...
reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo    Done — PlayerDebugMode=1 for CSXS 9-12

:: 2. Create symlink to CEP extensions directory
echo.
echo [2/2] Creating symlink in Adobe CEP extensions folder...

set "SOURCE=%~dp0"
set "TARGET=C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\com.subforge.subtitles"

:: Remove trailing backslash from SOURCE
if "%SOURCE:~-1%"=="\" set "SOURCE=%SOURCE:~0,-1%"

:: Check if symlink already exists
if exist "%TARGET%" (
    echo    Symlink already exists. Removing old link...
    rmdir "%TARGET%" 2>nul
    if exist "%TARGET%" (
        echo    ERROR: Could not remove existing folder. Try running as Administrator.
        goto :skip_link
    )
)

:: Create the extensions directory if it doesn't exist
if not exist "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions" (
    mkdir "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions" 2>nul
)

:: Also try the other common location
set "TARGET2=C:\Program Files\Common Files\Adobe\CEP\extensions\com.subforge.subtitles"

mklink /D "%TARGET%" "%SOURCE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo    Symlink created: %TARGET%
) else (
    echo    First path failed, trying alternate location...
    if not exist "C:\Program Files\Common Files\Adobe\CEP\extensions" (
        mkdir "C:\Program Files\Common Files\Adobe\CEP\extensions" 2>nul
    )
    mklink /D "%TARGET2%" "%SOURCE%" >nul 2>&1
    if %errorlevel% equ 0 (
        echo    Symlink created: %TARGET2%
    ) else (
        echo    ERROR: Could not create symlink. Run this script as Administrator.
        echo    Right-click install.bat and select "Run as administrator"
    )
)

:skip_link
echo.
echo ============================================
echo  Installation complete!
echo.
echo  Next steps:
echo    1. Restart Premiere Pro (if running)
echo    2. Open: Window ^> Extensions ^> SubForge Subtitles
echo ============================================
echo.
pause
