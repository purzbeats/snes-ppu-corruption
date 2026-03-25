@echo off
setlocal

:: SNES PPU Corruption Engine — PNG frame encoder
:: Drop this on your PATH, run it in the folder with frame_000000.png etc.
:: Usage: encode [fps] [--lossless]

set FPS=60
set LOSSLESS=0

:parse_args
if "%1"=="" goto done_args
if "%1"=="--lossless" (set LOSSLESS=1 & shift & goto parse_args)
set FPS=%1
shift
goto parse_args
:done_args

:: Detect frames
set COUNT=0
for %%f in (frame_*.png) do set /a COUNT+=1
if %COUNT%==0 (
    echo No frame_*.png files found in current directory.
    exit /b 1
)
echo Found %COUNT% frames, encoding at %FPS%fps...

for %%I in (.) do set DIRNAME=%%~nxI

if %LOSSLESS%==1 (
    echo.
    echo [LOSSLESS] yuv444p, crf 0 — perfect source for editing
    ffmpeg -framerate %FPS% -i frame_%%06d.png -c:v libx264 -crf 0 -preset medium -pix_fmt yuv444p "%DIRNAME%_lossless.mp4"
)

echo.
echo [HQ] yuv444p, crf 10 — for direct posting where yuv444p is supported
ffmpeg -framerate %FPS% -i frame_%%06d.png -c:v libx264 -crf 10 -preset medium -pix_fmt yuv444p -tune animation -movflags +faststart "%DIRNAME%_hq.mp4"

echo.
echo [SOCIAL] Instagram/TikTok/Twitter compatible
echo          yuv420p + silent audio + H.264 Main profile + faststart
ffmpeg -framerate %FPS% -i frame_%%06d.png -f lavfi -i anullsrc=r=48000:cl=stereo -c:v libx264 -profile:v main -level 4.0 -crf 10 -preset medium -pix_fmt yuv420p -tune animation -c:a aac -b:a 128k -shortest -movflags +faststart "%DIRNAME%_social.mp4"

echo.
echo Done!
if %LOSSLESS%==1 echo   %DIRNAME%_lossless.mp4  — lossless, editing only
echo   %DIRNAME%_hq.mp4        — near-lossless, yuv444p
echo   %DIRNAME%_social.mp4    — Instagram/TikTok/Twitter ready
