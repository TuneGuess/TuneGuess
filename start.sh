#!/bin/bash
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 Lancement de TuneGuess...${NC}"

cleanup() {
    echo -e "\n${RED}🛑 Arrêt des serveurs...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

echo -e "${GREEN}Démarrage du serveur Backend (Port 5000)...${NC}"
cd "$BACKEND_DIR" || exit 1
node server.js &
BACKEND_PID=$!

# 2. Démarrer le Frontend
echo -e "${GREEN}💻 Démarrage du serveur Frontend (Vite)...${NC}"
cd "$FRONTEND_DIR" || exit 1
npm run dev &
FRONTEND_PID=$!

# Attendre que les deux processus se terminent
wait
