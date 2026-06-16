#!/bin/bash

echo ""
echo " ============================================"
echo "  NexChat - Personal WhatsApp-like Chat App"
echo " ============================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo " [ERROR] Node.js is not installed!"
    echo " Please install from: https://nodejs.org"
    exit 1
fi

echo " [OK] Node.js $(node --version) found"

# Install deps if needed
if [ ! -d "node_modules" ]; then
    echo ""
    echo " Installing dependencies (first time only)..."
    npm install
    if [ $? -ne 0 ]; then
        echo " [ERROR] Failed to install!"
        exit 1
    fi
    echo " [OK] Dependencies installed!"
fi

# Create directories
mkdir -p data public/media public/avatars public/icons

echo ""
echo " Starting NexChat Server..."
echo " Open: http://localhost:3000"
echo " Press Ctrl+C to stop"
echo ""

# Open browser
sleep 2 && (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null) &

node server.js
