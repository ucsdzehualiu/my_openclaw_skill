#!/bin/bash
# free-web-search-js setup (Linux/macOS)
# v28

set -e
SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "=== free-web-search-js Setup ==="
echo ""
echo "Dependencies:"
echo "  - Node.js >= 18"
echo "  - npm packages: cheerio, commander, iconv-lite, playwright"
echo "  - Playwright Chromium browser (~150MB, takes a few minutes)"
echo ""

# Node.js
if ! command -v node &>/dev/null; then
    echo "[X] Node.js not found"
    echo "   -> https://nodejs.org"
    exit 1
fi
NODE_VERSION=$(node --version)
MAJOR=$(echo "$NODE_VERSION" | sed 's/^v//' | cut -d. -f1)
if [ "$MAJOR" -lt 18 ]; then
    echo "[X] Node.js >= 18 required (current: $NODE_VERSION)"
    exit 1
fi
echo "[OK] Node.js $NODE_VERSION"

# 检测国内网络 → 选镜像源
IN_CHINA=false
echo ""
echo "Detecting network region..."
for url in "https://myip.ipip.net" "https://cip.cc"; do
    if resp=$(curl -sS --max-time 3 "$url" 2>/dev/null); then
        if echo "$resp" | grep -qi "中国\|CN"; then
            IN_CHINA=true
            break
        fi
    fi
done

if [ "$IN_CHINA" = true ]; then
    echo "[OK] 国内网络，使用镜像源加速"
    export PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"
    NPM_REGISTRY="--registry=https://registry.npmmirror.com"
else
    echo "[OK] 海外网络，使用官方源"
    NPM_REGISTRY=""
fi

# npm install
echo ""
echo "Installing npm packages (cheerio, commander, iconv-lite, playwright)..."
cd "$SKILL_ROOT"
if [ -n "$NPM_REGISTRY" ]; then
    if ! npm install $NPM_REGISTRY; then
        echo "[X] npm install failed"
        exit 1
    fi
else
    if ! npm install; then
        echo "[X] npm install failed"
        exit 1
    fi
fi
echo "[OK] npm packages installed"

# Playwright Chromium
echo ""
echo "Installing Playwright Chromium browser (~150MB, this may take a few minutes)..."
if ! npx playwright install chromium || npx playwright install chromium-headless-shell; then
    echo "[X] Playwright Chromium install failed"
    echo "   Try manually: npx playwright install chromium
   If the download is slow/interrupted, retry or set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright || npx playwright install chromium-headless-shell"
    exit 1
fi
echo "[OK] Playwright Chromium installed"

echo ""
echo "[OK] Setup complete!"
echo "   Verify: node scripts/check-env.js"
