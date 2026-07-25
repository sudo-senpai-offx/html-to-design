@echo off
title HTML to Design - Launcher
echo.
echo  ====================================
echo   HTML to Design - Multi-Format Export
echo  ====================================
echo.
echo  Starting services...
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Please install Node.js 18+
    pause
    exit /b 1
)

:: Install root dependencies if needed
if not exist "node_modules\concurrently" (
    echo  Installing root dependencies...
    npm install
)

:: Install backend dependencies if needed
if not exist "backend\node_modules" (
    echo  Installing backend dependencies...
    cd backend && npm install && cd ..
)

:: Install frontend dependencies if needed
if not exist "frontend\node_modules" (
    echo  Installing frontend dependencies...
    cd frontend && npm install && cd ..
)

echo.
echo  Starting backend on http://localhost:3000
echo  Starting frontend on http://localhost:5173
echo.
echo  Press Ctrl+C to stop all services
echo.

npm run dev
