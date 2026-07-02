#!/bin/bash
# ============================================================
# QwenProxy-Cookies Import Script
# ============================================================
# Imports cookies from a URL (e.g. Pastebin raw) or a raw
# cookie string and saves them as cookies.json.
#
# Usage:
#   ./import-cookies.sh <url-or-cookie-string>
#
# Examples:
#   ./import-cookies.sh https://pastebin.com/raw/eCS7NwVf
#   ./import-cookies.sh "cookie1=value1; cookie2=value2"
# ============================================================

set -euo pipefail

INPUT="${1:-}"

if [ -z "$INPUT" ]; then
  echo "❌ No input provided."
  echo ""
  echo "Usage:"
  echo "  ./import-cookies.sh <url-or-cookie-string>"
  echo ""
  echo "Examples:"
  echo "  ./import-cookies.sh https://pastebin.com/raw/eCS7NwVf"
  echo '  ./import-cookies.sh "cookie1=value1; cookie2=value2"'
  exit 1
fi

COOKIES=""

# Check if input is a URL
if [[ "$INPUT" =~ ^https?:// ]]; then
  echo "📡 Downloading cookies from: $INPUT"
  COOKIES=$(curl -sSL "$INPUT" 2>/dev/null || true)

  if [ -z "$COOKIES" ]; then
    echo "❌ Failed to download cookies from URL."
    exit 1
  fi
  echo "✅ Cookies downloaded successfully!"
else
  COOKIES="$INPUT"
fi

# Validate cookies format (basic check)
if ! echo "$COOKIES" | grep -q '='; then
  echo "⚠️  Warning: The input doesn't look like valid cookies (no '=' found)."
  echo "   Saving anyway. You may need to edit cookies.json manually."
fi

# Trim leading/trailing whitespace
COOKIES="$(printf '%s\n' "$COOKIES" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

# Check if cookies are in JSON array format (starts with [)
if [[ "$COOKIES" =~ ^[[:space:]]*\[ ]]; then
  echo "  → Detected JSON array of cookies format"
else
  # Normalize: if cookies span multiple lines (no semicolons), replace newlines with "; "
  # This handles Pastebin format where each cookie is on its own line.
  if echo "$COOKIES" | grep -q ';'; then
    # Already has semicolons — just flatten newlines
    COOKIES="$(echo "$COOKIES" | tr -d '\n')"
  else
    # No semicolons — check if multi-line, and convert newlines to "; "
    LINE_COUNT="$(echo "$COOKIES" | wc -l)"
    if [ "$LINE_COUNT" -gt 1 ]; then
      COOKIES="$(echo "$COOKIES" | tr '\n' ';' | sed 's/; */; /g; s/; *$//; s/^ *//')"
      echo "  → Converted newline-separated cookies to semicolon format"
    fi
  fi
fi

# Detect if the cookies are in JSON format already
if printf '%s\n' "$COOKIES" | grep -q '^{.*"cookies"'; then
  printf '%s\n' "$COOKIES" > cookies.json
  echo "✅ Detected JSON format. Saved to cookies.json"
  exit 0
fi

# Use Node.js to safely generate JSON with proper escaping of special characters.
# Piping via stdin handles any special characters and avoids argv length limits.
printf '%s\n' "$COOKIES" | node -e "
const fs = require('fs');
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  let cookies = input.trim();
  if (cookies.startsWith('[')) {
    try {
      const parsed = JSON.parse(cookies);
      if (Array.isArray(parsed)) {
        cookies = parsed.map(c => \`\${c.name}=\${c.value}\`).join('; ');
        console.log('  → Parsed JSON array of cookies successfully');
      }
    } catch (e) {
      console.warn('  ⚠️ Failed to parse cookies as JSON array, saving raw');
    }
  }
  const config = {
    cookies: cookies,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    bxV: '2.5.36',
    bxUa: '',
    bxUmidtoken: ''
  };
  fs.writeFileSync('cookies.json', JSON.stringify(config, null, 2) + '\n');
  console.log('  → JSON file generated successfully');
});
"

echo ""
echo "============================================"
echo "  ✅ Cookies saved to cookies.json!"
echo "============================================"
echo ""
echo "Cookies extracted: $(echo "$COOKIES" | tr ';' '\n' | wc -l) entries"
echo ""
echo "Next step:"
echo "  npm start"
echo ""
