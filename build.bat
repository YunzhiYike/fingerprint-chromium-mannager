@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ====================================
echo   指纹浏览器管理器 - Windows 打包工具
echo ====================================
echo.

REM 检查Node.js是否安装
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

REM 显示Node.js版本
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [信息] Node.js 版本: %NODE_VERSION%

REM 获取用户输入
set "PLATFORM=%1"
if "%PLATFORM%"=="" (
    echo.
    echo 请选择打包平台:
    echo   1. Windows
    echo   2. macOS
    echo   3. 所有平台
    echo   4. 当前平台 ^(推荐^)
    echo.
    set /p choice="请输入选项 (1-4, 默认为4): "
    
    if "!choice!"=="" set choice=4
    
    if "!choice!"=="1" set PLATFORM=windows
    if "!choice!"=="2" set PLATFORM=mac
    if "!choice!"=="3" set PLATFORM=all
    if "!choice!"=="4" set PLATFORM=current
)

echo.
echo [信息] 开始为 %PLATFORM% 平台打包...
echo.

REM 执行打包 (使用.npmrc配置)
node build-simple.js %PLATFORM%

if %ERRORLEVEL% equ 0 (
    echo.
    echo [成功] 打包完成！
    echo [信息] 构建文件位置: .\dist\
    echo.
    
    REM 询问是否打开构建目录
    set /p open="是否打开构建目录? (y/N): "
    if /i "!open!"=="y" (
        if exist "dist" (
            start "" "dist"
        ) else (
            echo [警告] 构建目录不存在
        )
    )
) else (
    echo.
    echo [错误] 打包失败！
    echo 请检查上方的错误信息
)

echo.
pause 