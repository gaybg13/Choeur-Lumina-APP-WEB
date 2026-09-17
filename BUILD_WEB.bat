@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo   Choeur Lumina Web v2.8.0 - Construction
echo ==============================================
where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERREUR : Node.js / npm n'est pas installe sur cet ordinateur.
  echo Installe Node.js puis relance ce fichier.
  pause
  exit /b 1
)
echo.
echo Installation des dependances...
call npm install
if errorlevel 1 goto :error
echo.
echo Construction de la Web App...
call npm run build
if errorlevel 1 goto :error
echo.
echo OK - Le dossier dist vient d'etre genere en version 2.8.0.
pause
exit /b 0
:error
echo.
echo La construction a echoue. Lis les messages ci-dessus.
pause
exit /b 1
