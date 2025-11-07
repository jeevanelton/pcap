@echo off
REM PCAP Analyzer - Quick Start Script for Windows
REM This script sets up and starts the PCAP Analyzer using Docker

echo.
echo ================================
echo PCAP Analyzer - Quick Start
echo ================================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not installed. Please install Docker Desktop first.
    echo Visit: https://docs.docker.com/desktop/install/windows-install/
    pause
    exit /b 1
)

REM Check if Docker Compose is installed
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker Compose is not installed.
    pause
    exit /b 1
)

echo [OK] Docker is installed
echo [OK] Docker Compose is installed
echo.

REM Check if .env file exists
if not exist .env (
    echo Creating .env file from template...
    copy .env.example .env
    echo WARNING: Please edit .env file and set JWT_SECRET_KEY
    echo.
) else (
    echo [OK] .env file already exists
)

echo.
echo Starting Docker containers...
echo.

REM Pull latest images
docker-compose pull

REM Build and start containers
docker-compose up -d

echo.
echo Waiting for services to be ready...
timeout /t 10 /nobreak >nul

echo.
echo ================================
echo PCAP Analyzer is running!
echo ================================
echo.
echo Access points:
echo    Frontend:  http://localhost
echo    Backend:   http://localhost:8000
echo    API Docs:  http://localhost:8000/docs
echo.
echo Next steps:
echo    1. Open http://localhost in your browser
echo    2. Click 'Register' to create an account
echo    3. Login and start analyzing PCAP files!
echo.
echo Useful commands:
echo    View logs:     docker-compose logs -f
echo    Stop:          docker-compose stop
echo    Restart:       docker-compose restart
echo    Remove:        docker-compose down
echo.
pause
