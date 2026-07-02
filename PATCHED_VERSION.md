# QwenProxy-Cookies (Patched Version)

This is an automatically patched version of QwenProxy.

## What is different?
- No Playwright required - This version works with cookies only
- Lightweight - No browser automation, no heavy dependencies
- Same API - Fully compatible with the original OpenAI-style API

## Quick Start

```bash
# Install dependencies
npm install

# Import cookies from a Pastebin URL (or any raw cookie URL)
bash import-cookies.sh https://pastebin.com/raw/XXXXXXXX
# Or use npm script:
npm run import-cookies -- https://pastebin.com/raw/XXXXXXXX
# Or set directly via env var:
export QWEN_COOKIES="cookie1=value1; cookie2=value2"

# Start the server
npm start
```

> ⚠️ **Updating an existing clone:** This branch uses `git push -f` (force push),
> so do NOT use `git pull` to update. Instead, run:
> ```bash
> git fetch origin
> git reset --hard origin/Patcher
> ```
> This overwrites local files with the latest patched version.
> **Warning:** Discards local changes. Backup `cookies.json` first.

## Original Source
- Repo: https://github.com/pedrofariasx/qwenproxy
- Commit: f486365f7a26237a42272fbb516782c63cc142c3
- Message: chore(release): 1.12.7 [skip ci]
- Patched at: 2026-07-02 14:18:56 UTC
