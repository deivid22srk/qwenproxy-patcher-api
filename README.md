# QwenProxy-Cookies 🍪

![Build Patcher](https://github.com/deivid22srk/qwenproxy-Cookies/actions/workflows/build.yml/badge.svg)

**QwenProxy-Cookies** is an automatically patched fork of [QwenProxy](https://github.com/pedrofariasx/qwenproxy) that **removes the Playwright dependency** and works with cookies only.

## 🌟 Why this fork?

The original QwenProxy uses **Playwright** (browser automation) to:
- Launch a headless browser
- Login to chat.qwen.ai
- Extract session tokens

This is heavy and requires installing browser binaries (~500MB+). This patched version replaces Playwright with **direct cookie-based authentication**, making it:

- ✅ **Lightweight** — No browser needed
- ✅ **Fast startup** — No browser launch time
- ✅ **Low memory** — No headless browser running
- ✅ **Docker-friendly** — Smaller images, no Playwright deps

## 📋 How it works

Instead of launching a browser, you provide your Qwen session cookies:

1. **Login to [chat.qwen.ai](https://chat.qwen.ai)** in your browser
2. **Extract your cookies** (via DevTools → Application → Cookies)
3. **Set the `QWEN_COOKIES`** environment variable or create a `cookies.json` file

## 🚀 Quick Start

```bash
# 1. Clone this repo's Patcher branch
git clone -b Patcher https://github.com/deivid22srk/qwenproxy-Cookies.git
cd qwenproxy-Cookies

# 2. Install dependencies (no Playwright!)
npm install

# 3. Import cookies from a URL (Pastebin, etc.)
bash import-cookies.sh https://pastebin.com/raw/XXXXXXXX
# Or use npm script:
npm run import-cookies -- https://pastebin.com/raw/XXXXXXXX
# Or set directly via env var:
export QWEN_COOKIES="cookie1=value1; cookie2=value2"

# 4. Start the server
npm start
```

> **⚠️ Updating an existing clone:** Because the patcher uses `git push -f` (force push),
> do NOT use `git pull` to update your local clone. Instead, run:
> ```bash
> git fetch origin
> git reset --hard origin/Patcher
> ```
> This overwrites your local files with the latest patched version.
> **Warning:** This discards any local changes. Backup your `cookies.json` first.

The server will start at `http://localhost:3000` with the full OpenAI-compatible API.

## 📥 Importing Cookies from a URL

The easiest way to get started is to import your cookies directly from a URL:

```bash
# Import from Pastebin raw URL
bash import-cookies.sh https://pastebin.com/raw/eCS7NwVf

# Or using npm script
npm run import-cookies -- https://pastebin.com/raw/eCS7NwVf
```

This will:
1. Download the cookies from the URL
2. Auto-detect if it's a raw cookie string or JSON format
3. Save them as `cookies.json` with proper formatting
4. Show you how many cookies were extracted

You can also pass a raw cookie string directly:

```bash
bash import-cookies.sh "cookie1=value1; cookie2=value2"
```

## 🍪 Getting Your Cookies Manually

### Chrome / Edge
1. Go to [https://chat.qwen.ai](https://chat.qwen.ai) and login
2. Open DevTools: `F12` or `Ctrl+Shift+I`
3. Go to **Application** → **Cookies** → `https://chat.qwen.ai`
4. Right-click → **Copy All** (or copy as a string)
5. Set as: `export QWEN_COOKIES="cookie1=value1; cookie2=value2"`

### Firefox
1. Login to [chat.qwen.ai](https://chat.qwen.ai)
2. Open DevTools: `F12` or `Ctrl+Shift+I`
3. Go to **Storage** → **Cookies** → `https://chat.qwen.ai`
4. Copy cookies as a semicolon-separated string
5. You can also use extensions like "EditThisCookie" to export

### Using cookies.json
```json
{
  "cookies": "cookie1=value1; cookie2=value2",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
  "bxV": "2.5.36"
}
```

You can also use the import script to generate this file automatically:

```bash
# This creates cookies.json from a URL
bash import-cookies.sh https://pastebin.com/raw/XXXXXXXX
```

## 🔧 Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `QWEN_COOKIES` | Your Qwen session cookies | Required |
| `PORT` | Server port | `3000` |
| `API_KEY` | API authentication key | (none) |
| `QWEN_EMAIL` | Qwen account email | For login fallback |
| `QWEN_PASSWORD` | Qwen account password | For login fallback |
| `BX_UA` | Browser bx-ua header | (optional) |
| `BX_UMIDTOKEN` | Browser bx-umidtoken header | (optional) |

## 🔄 Automatic Updates

This repo has a **GitHub Actions workflow** that runs every 6 hours to:
1. Check the original [QwenProxy](https://github.com/pedrofariasx/qwenproxy) for updates
2. Apply the cookie patcher
3. Push the latest patched code to the `Patcher` branch

You can also trigger it manually via the Actions tab.

## 📦 Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 3000
ENV QWEN_COOKIES=""
CMD ["npm", "start"]
```

## 📝 License

Same as the original: [ISC License](LICENSE)

---

**Disclaimer:** This project is for educational purposes only.
