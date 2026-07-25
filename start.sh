#!/usr/bin/env bash
set -e

BOLD='\033[1m'
GREEN='\033[32m'
CYAN='\033[36m'
YELLOW='\033[33m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}  ===================================="
echo "   HTML to Design - Multi-Format Export"
echo -e "  ====================================${RESET}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}  [ERROR] Node.js not found. Please install Node.js 18+${RESET}"
    exit 1
fi

echo -e "${CYAN}  Node.js:$(node -v)${RESET}"
echo -e "${CYAN}  npm:$(npm -v)${RESET}"
echo ""

# Install root dependencies
if [ ! -d "node_modules/concurrently" ]; then
    echo "  Installing root dependencies..."
    npm install
fi

# Install backend dependencies
if [ ! -d "backend/node_modules" ]; then
    echo "  Installing backend dependencies..."
    (cd backend && npm install)
fi

# Install frontend dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo "  Installing frontend dependencies..."
    (cd frontend && npm install)
fi

echo ""
echo -e "${GREEN}  Backend:  http://localhost:3000${RESET}"
echo -e "${GREEN}  Frontend: http://localhost:5173${RESET}"
echo ""
echo "  Press Ctrl+C to stop all services"
echo ""

npm run dev
