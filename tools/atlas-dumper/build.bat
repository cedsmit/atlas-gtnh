@echo off
REM ============================================================================
REM  Atlas Dumper - one-click build
REM  Double-click this file. It finds your JDK + the Forge/Minecraft jars,
REM  compiles the mod, and writes atlas-dumper-<version>.jar next to it.
REM  No Gradle, no editing paths - unless auto-detect fails (see below).
REM ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "VERSION=1.4.0"
set "MCVER=1.7.10"

REM ==== Manual override - ONLY if auto-detect below fails ====================
REM   Remove the "REM " and put in your real paths, then re-run.
REM set "FORGE=C:\path\to\forge-1.7.10-...-universal.jar"
REM set "MC=C:\path\to\minecraft-1.7.10-client.jar"
REM ==========================================================================

echo ============================================================
echo   Atlas Dumper  -  build v%VERSION%
echo ============================================================
echo.

REM --- 1. Locate javac + jar (PATH first, then JAVA_HOME) --------------------
set "JAVAC="
set "JARC="
for /f "delims=" %%J in ('where javac 2^>nul') do if not defined JAVAC set "JAVAC=%%J"
for /f "delims=" %%J in ('where jar 2^>nul')   do if not defined JARC  set "JARC=%%J"
if not defined JAVAC if exist "%JAVA_HOME%\bin\javac.exe" set "JAVAC=%JAVA_HOME%\bin\javac.exe"
if not defined JARC  if exist "%JAVA_HOME%\bin\jar.exe"   set "JARC=%JAVA_HOME%\bin\jar.exe"
if not defined JAVAC (
  echo [ERROR] Could not find javac. Install a JDK 8+ or set JAVA_HOME.
  goto :fail
)
if not defined JARC set "JARC=jar"
echo [ok]  javac : %JAVAC%

REM --- 2. Locate Forge universal + Minecraft client jars --------------------
if not defined FORGE for /f "delims=" %%F in ('dir /b /s "%APPDATA%\PrismLauncher\libraries\net\minecraftforge\forge\*universal*.jar" 2^>nul') do set "FORGE=%%F"
if not defined FORGE for /f "delims=" %%F in ('dir /b /s "%APPDATA%\MultiMC\libraries\net\minecraftforge\forge\*universal*.jar" 2^>nul')     do set "FORGE=%%F"
if not defined MC    for /f "delims=" %%F in ('dir /b /s "%APPDATA%\PrismLauncher\libraries\com\mojang\minecraft\*client*.jar" 2^>nul')       do set "MC=%%F"
if not defined MC    for /f "delims=" %%F in ('dir /b /s "%APPDATA%\MultiMC\libraries\com\mojang\minecraft\*client*.jar" 2^>nul')           do set "MC=%%F"

if not defined FORGE (
  echo [ERROR] Forge universal jar not found.
  echo         Looked under %%APPDATA%%\PrismLauncher\libraries and MultiMC.
  echo         Set FORGE= in the "Manual override" block at the top of this file.
  goto :fail
)
if not defined MC (
  echo [ERROR] minecraft-1.7.10-client.jar not found.
  echo         Set MC= in the "Manual override" block at the top of this file.
  goto :fail
)
echo [ok]  forge : %FORGE%
echo [ok]  mc    : %MC%
echo.

REM --- 3. Compile -----------------------------------------------------------
set "SRC=src\main\java\com\atlasgtnh\icondumper\AtlasDumper.java"
set "OUT=%TEMP%\atlas-dumper-build"
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"
echo [..] compiling...
"%JAVAC%" --release 8 -Xlint:-options -cp "%FORGE%;%MC%" -d "%OUT%" "%SRC%"
if errorlevel 1 goto :fail
echo [ok]  compiled

REM --- 4. Stage resources (substitute Gradle tokens in mcmod.info) ----------
copy /y "src\main\resources\pack.mcmeta" "%OUT%\pack.mcmeta" >nul
powershell -NoProfile -Command "(Get-Content -Raw 'src\main\resources\mcmod.info') -replace '\$\{version\}','%VERSION%' -replace '\$\{mcversion\}','%MCVER%' | Set-Content -Encoding ascii '%OUT%\mcmod.info'"
if errorlevel 1 goto :fail

REM --- 5. Package the jar ---------------------------------------------------
set "JARNAME=atlas-dumper-%VERSION%.jar"
"%JARC%" cf "%JARNAME%" -C "%OUT%" .
if errorlevel 1 goto :fail
echo [ok]  packaged %JARNAME%
echo.
echo ============================================================
echo   DONE  -  %CD%\%JARNAME%
echo ============================================================
echo.

REM --- 6. Optional: install into a chosen instance's mods folder -----------
set "N=0"
for /f "delims=" %%I in ('dir /b "%APPDATA%\PrismLauncher\instances" 2^>nul ^| findstr /i "horizon gtnh GT_New"') do (
  set /a N+=1
  set "NAME[!N!]=%%I"
  set "MODS[!N!]=%APPDATA%\PrismLauncher\instances\%%I\.minecraft\mods"
)
if %N%==0 (
  echo No GTNH instances auto-detected under Prism.
  echo Copy %JARNAME% into your instance's mods folder manually.
  goto :end
)
echo Install into which instance's mods folder? (replaces any older atlas-dumper jars there)
for /l %%K in (1,1,%N%) do echo    [%%K]  !NAME[%%K]!
echo    [0]  skip
echo.
set "PICK="
set /p "PICK=Enter a number: "
if not defined PICK goto :end
if "%PICK%"=="0" goto :end
set "CHOSEN=!MODS[%PICK%]!"
if not defined CHOSEN (
  echo [warn] "%PICK%" is not one of the listed choices - skipped.
  goto :end
)
if not exist "!CHOSEN!" (
  echo [warn] Folder not found: !CHOSEN!
  echo        Copy %JARNAME% in manually.
  goto :end
)
REM --- Remove any previously installed copies of this mod (all versions) -----
REM   Matches atlas*dumper*.jar so old versions AND a same-version rebuild
REM   are cleared out first, leaving exactly one jar after the copy below.
set "REMOVED=0"
for %%O in ("!CHOSEN!\atlas*dumper*.jar") do (
  del /f /q "%%~fO" >nul 2>&1
  if exist "%%~fO" (
    echo [warn] could not remove %%~nxO ^(is the game running? close it and retry^)
  ) else (
    set /a REMOVED+=1
    echo    removed old  %%~nxO
  )
)
echo [ok]  old copies removed: !REMOVED!
copy /y "%JARNAME%" "!CHOSEN!" >nul && echo Installed %JARNAME% into !CHOSEN!
goto :end

:fail
echo.
echo *** BUILD FAILED - see the messages above. ***

:end
echo.
pause
endlocal
