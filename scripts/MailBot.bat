@echo off
setlocal
title MailBot
rem Proje klasoru — masaustu kopyasinda mutlak yol yazilir.
set "MAILBOT_DIR=%~dp0.."
cd /d "%MAILBOT_DIR%"

echo.
echo   MailBot baslatiliyor...
echo   ------------------------------------------------
echo.

rem --- 1. SearXNG (Docker) --------------------------------------------------
docker info >nul 2>&1
if errorlevel 1 (
  echo   [ ] Docker calismiyor - SearXNG baslatilamadi.
  echo       Discovery icin Docker Desktop'i acip su komutu calistirin:
  echo       docker compose -f infra\docker-compose.yml up -d
) else (
  docker compose -f infra\docker-compose.yml up -d >nul 2>&1
  if errorlevel 1 (
    echo   [ ] SearXNG baslatilamadi.
  ) else (
    echo   [x] SearXNG        http://localhost:8080
  )
)

rem --- 2. n8n --------------------------------------------------------------
curl -s -o nul -m 3 http://localhost:5678 >nul 2>&1
if errorlevel 1 (
  echo   [ ] n8n kapali      - kesif otomasyonu calismaz ^(localhost:5678^)
) else (
  echo   [x] n8n             http://localhost:5678
)

rem --- 3. Next.js uygulamasi ------------------------------------------------
start "MailBot - Uygulama" cmd /c "npm run dev"
echo   [x] Uygulama        http://localhost:3000

rem --- 4. Kalici Cloudflare tuneli (yalnizca alan adi baglanmissa) ----------
rem Gecici tunel adresleri maile konamaz, o yuzden burada acilmaz.
findstr /R /C:"^CLOUDFLARE_TUNNEL_NAME=\"..*\"" .env >nul 2>&1
if errorlevel 1 (
  echo   [ ] Tunel           kapali - acilma takibi devre disi
) else (
  start "MailBot - Tunel" cmd /c "npm run tunnel"
  echo   [x] Tunel           acilma takibi acik
)

rem --- 5. Discord botu ------------------------------------------------------
start "MailBot - Discord Bot" cmd /c "npm run bot"
echo   [x] Discord botu    ayri pencerede

rem --- 6. Tarayici ----------------------------------------------------------
echo.
echo   Uygulamanin acilmasi bekleniyor...
timeout /t 6 /nobreak >nul
start "" http://localhost:3000

echo.
echo   Hazir. Bu pencereyi kapatabilirsiniz.
echo   Durdurmak icin acilan "MailBot - ..." pencerelerini kapatin.
echo.
timeout /t 4 /nobreak >nul
endlocal
