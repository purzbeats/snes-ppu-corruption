@echo off
setlocal

:: SNES PPU Corruption Engine — PNG frame encoder
:: Drop this on your PATH, run it in the folder with frame_000000.png etc.
:: Usage: encode [fps]    (default: 60)

set FPS=%1
if "%FPS%"=="" set FPS=60

:: Detect frame count
set COUNT=0
for %%f in (frame_*.png) do set /a COUNT+=1
if %COUNT%==0 (
    echo No frame_*.png files found in current directory.
    exit /b 1
)
echo Found %COUNT% frames, encoding at %FPS%fps...

:: Get folder name for output filename
for %%I in (.) do set DIRNAME=%%~nxI

echo.
echo [1/3] Lossless (yuv444p, crf 0) — perfect source for editing
ffmpeg -framerate %FPS% -i frame_%%06d.png -c:v libx264 -crf 0 -preset veryslow -pix_fmt yuv444p "%DIRNAME%_lossless.mp4"

echo.
echo [2/3] High quality (yuv444p, crf 10) — for direct posting
ffmpeg -framerate %FPS% -i frame_%%06d.png -c:v libx264 -crf 10 -preset veryslow -pix_fmt yuv444p -tune animation -movflags +faststart "%DIRNAME%_hq.mp4"

echo.
echo [3/3] Social compatible (yuv420p, crf 8) — max platform compat
ffmpeg -framerate %FPS% -i frame_%%06d.png -c:v libx264 -crf 8 -preset veryslow -pix_fmt yuv420p -tune animation -movflags +faststart "%DIRNAME%_social.mp4"

echo.
echo Done! Output files:
echo   %DIRNAME%_lossless.mp4  — lossless, huge
echo   %DIRNAME%_hq.mp4        — near-lossless, yuv444p
echo   %DIRNAME%_social.mp4    — social media ready
