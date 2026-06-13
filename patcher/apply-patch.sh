#!/bin/bash
# ============================================================
# QwenProxy → QwenProxy-Cookies Patcher
# ============================================================
# This script transforms the original QwenProxy project to work
# WITHOUT Playwright, using only cookies for API authentication.
#
# Usage:
#   ./patcher/apply-patch.sh [path-to-qwenproxy]
#
# If no path is provided, it patches the current directory.
# ============================================================

set -euo pipefail

PROJECT_DIR="${1:-$(pwd)}"
# Convert PROJECT_DIR to absolute path to avoid Node.js require() resolution issues
case "$PROJECT_DIR" in
  /*) ;;
  *) PROJECT_DIR="$(pwd)/$PROJECT_DIR" ;;
esac
PATCHER_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "============================================================"
echo "  QwenProxy → QwenProxy-Cookies Patcher"
echo "============================================================"
echo "Project directory: $PROJECT_DIR"
echo ""

# Step 1: Replace src/services/playwright.ts with cookie-based version
echo "[Step 1/8] Replacing playwright.ts with cookie-based service..."
if [ -f "$PROJECT_DIR/src/services/playwright.ts" ]; then
  # Backup original
  cp "$PROJECT_DIR/src/services/playwright.ts" "$PROJECT_DIR/src/services/playwright.ts.playwright-backup"
  echo "  → Backed up original to playwright.ts.playwright-backup"
fi

# Copy the cookie-based replacement
cp "$PATCHER_DIR/patcher/playwright-cookies.ts" "$PROJECT_DIR/src/services/playwright.ts"
echo "  → Replaced with cookie-based service"

# Step 2: Remove playwright from package.json dependencies
echo "[Step 2/8] Removing Playwright from package.json..."
if [ -f "$PROJECT_DIR/package.json" ]; then
  # Use node to safely manipulate package.json
  node -e "
    const pkg = require('$PROJECT_DIR/package.json');
    // Remove playwright from dependencies
    if (pkg.dependencies && pkg.dependencies.playwright) {
      delete pkg.dependencies.playwright;
      console.log('  → Removed playwright from dependencies');
    }
    // Remove @playwright/test if present
    if (pkg.devDependencies && pkg.devDependencies['@playwright/test']) {
      delete pkg.devDependencies['@playwright/test'];
      console.log('  → Removed @playwright/test from devDependencies');
    }
    // Update scripts - remove browser-specific start commands and use node-direct tsx to bypass shebang issues in environments like Termux
    if (pkg.scripts) {
      const fixScript = (cmd) => cmd ? cmd.replace(/^npx tsx\b/, 'node node_modules/tsx/dist/cli.mjs').replace(/^tsx\b/, 'node node_modules/tsx/dist/cli.mjs') : cmd;
      const scripts = {
        start: fixScript(pkg.scripts.start),
        'start:simple': 'node node_modules/tsx/dist/cli.mjs src/index.ts',
        login: fixScript(pkg.scripts.login),
        test: fixScript(pkg.scripts.test),
        typecheck: pkg.scripts.typecheck,
      };
      pkg.scripts = scripts;
      console.log('  → Updated scripts to use node-direct tsx (fixed shebang issue)');
    }
    // Write updated package.json
    require('fs').writeFileSync('$PROJECT_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
fi

# Step 3: Update src/api/server.ts to use cookie-based initialization
echo "[Step 3/8] Updating server initialization..."
if [ -f "$PROJECT_DIR/src/api/server.ts" ]; then
  node "$PATCHER_DIR/patcher/patch-server.js" "$PROJECT_DIR"
fi

# Step 4: Update .env.example with cookie configuration
echo "[Step 4/8] Updating configuration examples..."

# Check if .env.example exists, update it
if [ -f "$PROJECT_DIR/.env.example" ]; then
  cat >> "$PROJECT_DIR/.env.example" << 'ENVEOF'

# ============================================================
# COOKIE MODE (replaces Playwright)
# ============================================================
# Instead of using Playwright to automate a browser, you can
# provide your Qwen session cookies directly.
#
# How to get your cookies:
# 1. Login to https://chat.qwen.ai in your browser
# 2. Open DevTools (F12) → Application → Cookies
# 3. Copy all cookies as: "name=value; name2=value2"
# 4. Set QWEN_COOKIES below
#
# QWEN_COOKIES=cookie1=value1; cookie2=value2
#
# Optional: Provide additional headers from the browser
# BX_UA=your-bx-ua-header
# BX_UMIDTOKEN=your-bx-umidtoken
# BX_V=2.5.36
ENVEOF
  echo "  → Updated .env.example with cookie configuration"
fi

# Step 5: Create cookies.json.example
echo "[Step 5/8] Creating cookies.json.example..."
cat > "$PROJECT_DIR/cookies.json.example" << 'JSONEOF'
{
  "cookies": "cookie1=value1; cookie2=value2",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "bxV": "2.5.36",
  "bxUa": "",
  "bxUmidtoken": ""
}
JSONEOF
echo "  → Created cookies.json.example"

# Step 6: Add import-cookies.sh script
echo "[Step 6/8] Adding import-cookies.sh..."
cp "$PATCHER_DIR/patcher/import-cookies.sh" "$PROJECT_DIR/import-cookies.sh"
chmod +x "$PROJECT_DIR/import-cookies.sh"
echo "  → Added import-cookies.sh - use it to import cookies from a URL"

# Also add the import-cookies npm script to package.json
if [ -f "$PROJECT_DIR/package.json" ]; then
  node -e "
    const pkg = require('$PROJECT_DIR/package.json');
    if (pkg.scripts) {
      pkg.scripts['import-cookies'] = 'bash import-cookies.sh';
      console.log('  → Added npm run import-cookies script');
    }
    require('fs').writeFileSync('$PROJECT_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
fi

# Step 7: Replace README.md with the cookie-based version
echo "[Step 7/8] Replacing README.md with cookie-based version..."
if [ -f "$PATCHER_DIR/README.md" ]; then
  cp "$PATCHER_DIR/README.md" "$PROJECT_DIR/README.md"
  echo "  → Replaced README.md with cookie-based instructions"
fi

# Step 8: Patch chat.ts to support cookie-based mode without accounts
echo "[Step 8/8] Patching chat.ts for cookie-based mode..."
if [ -f "$PROJECT_DIR/src/routes/chat.ts" ]; then
  node "$PATCHER_DIR/patcher/patch-chat.js" "$PROJECT_DIR"
fi

# Make patch scripts executable
chmod +x "$PATCHER_DIR/patcher/patch-server.js" 2>/dev/null || true
chmod +x "$PATCHER_DIR/patcher/patch-chat.js" 2>/dev/null || true
echo ""

echo "============================================================"
echo "  ✅ Patch complete!"
echo "============================================================"
echo ""
echo "Next steps:"
echo "  1. Get your cookies from chat.qwen.ai"
echo "     OR import from a URL:"
echo "       npx tsx import-cookies.sh https://pastebin.com/raw/XXXXX"
echo "       npm run import-cookies -- https://pastebin.com/raw/XXXXX"
echo "  2. Start the server:"
echo "       npm start"
echo ""
echo "To update later (Patcher branch uses force push):"
echo "  git fetch origin"
echo "  git reset --hard origin/Patcher"
echo "  (Discards local changes - backup cookies.json first)"
echo ""
echo "Note: The original playwright.ts was backed up as:"
echo "  src/services/playwright.ts.playwright-backup"
echo "============================================================"
