#!/bin/bash
# ═══════════════════════════════════════════════════════════
# PTE SWT Practice Portal — LAN Server
# Run this on ONE office PC. All other PCs connect via browser.
# ═══════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  PTE SWT Practice Portal — LAN Server               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Get LAN IP
if command -v ip &> /dev/null; then
    LAN_IP=$(ip route get 1 | awk '{print $7; exit}')
elif command -v ipconfig &> /dev/null; then
    LAN_IP=$(ipconfig | grep -m1 "IPv4" | awk '{print $NF}')
else
    LAN_IP="<your-pc-ip>"
fi

PORT=${PORT:-3001}

echo "🚀 Starting server on port $PORT..."
echo ""
echo "════════════════════════════════════════════════════════"
echo "  Access from THIS PC:    http://localhost:$PORT"
echo "  Access from OTHER PCs:  http://$LAN_IP:$PORT"
echo "  Data stored in:         ./data/pte_data.json"
echo "════════════════════════════════════════════════════════"
echo ""
echo "📋 Share this URL with your office:  http://$LAN_IP:$PORT"
echo ""
echo "Press Ctrl+C to stop the server."
echo ""

PORT=$PORT node server.js
