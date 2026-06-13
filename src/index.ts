import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const app = new Hono();

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>QwenProxy Cookies Patcher API</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          background: #121214;
          color: #e1e1e6;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
        }
        .container {
          background: #202024;
          border-radius: 8px;
          padding: 40px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
          max-width: 600px;
          width: 100%;
          text-align: center;
        }
        h1 {
          color: #04d361;
          margin-top: 0;
        }
        p {
          line-height: 1.6;
          color: #a8a8b3;
        }
        .btn {
          display: inline-block;
          background: #04d361;
          color: #0a0a0c;
          text-decoration: none;
          padding: 14px 28px;
          border-radius: 6px;
          font-weight: bold;
          margin-top: 20px;
          transition: background 0.2s, transform 0.1s;
        }
        .btn:hover {
          background: #03b050;
        }
        .btn:active {
          transform: scale(0.98);
        }
        .code-box {
          background: #121214;
          padding: 15px;
          border-radius: 6px;
          text-align: left;
          font-family: monospace;
          color: #04d361;
          overflow-x: auto;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>QwenProxy Cookies Patcher API 🍪</h1>
        <p>This API dynamically clones the official <strong>QwenProxy</strong> repository, applies the lightweight cookie-based patcher (removing Playwright and native shebang incompatibilities), and packages it into a zip archive.</p>
        
        <div class="code-box">
          GET /patch &rarr; Downloads the patched zip package
        </div>

        <a href="/patch" class="btn">Download Patched Package</a>
      </div>
    </body>
    </html>
  `);
});

app.get('/patch', async (c) => {
  const patchId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const tempDir = path.join(PROJECT_ROOT, `tmp-${patchId}`);
  const originalDir = path.join(tempDir, 'qwenproxy');
  const zipPath = path.join(PROJECT_ROOT, `qwenproxy-${patchId}.zip`);

  console.log(`[API] Starting patch workflow: ID=${patchId}`);

  try {
    // 1. Create temporary directory
    fs.mkdirSync(tempDir, { recursive: true });

    // 2. Clone the original QwenProxy repo
    console.log(`[API] Cloning original qwenproxy...`);
    await execAsync(`git clone --depth 1 https://github.com/pedrofariasx/qwenproxy.git "${originalDir}"`);

    // 3. Apply the patcher
    console.log(`[API] Applying cookie-based patch...`);
    const patcherScript = path.join(PROJECT_ROOT, 'patcher', 'apply-patch.sh');
    await execAsync(`bash "${patcherScript}" "${originalDir}"`);

    // 4. Compress the patched codebase into a zip file
    console.log(`[API] Creating zip archive...`);
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      // Append the directory, renaming it inside the zip to qwenproxy-cookies
      archive.directory(originalDir, 'qwenproxy-cookies');
      archive.finalize();
    });

    console.log(`[API] Zip ready, sending download...`);

    // Read the zip file buffer to send as the response body
    const zipBuffer = fs.readFileSync(zipPath);

    // Clean up files in background asynchronously
    setTimeout(() => {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        if (fs.existsSync(zipPath)) {
          fs.rmSync(zipPath, { force: true });
        }
        console.log(`[API] Cleaned up temp files for ID=${patchId}`);
      } catch (err) {
        console.error(`[API] Failed to clean up temp files for ID=${patchId}:`, err);
      }
    }, 5000);

    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="qwenproxy-cookies.zip"`);
    return c.body(zipBuffer);

  } catch (error: any) {
    console.error(`[API] Patching failed for ID=${patchId}:`, error);

    // Clean up on error
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      if (fs.existsSync(zipPath)) {
        fs.rmSync(zipPath, { force: true });
      }
    } catch (e) {
      console.error('[API] Error cleaning up after failure:', e);
    }

    return c.json({
      success: false,
      error: error.message || 'An error occurred during patching',
    }, 500);
  }
});

const port = Number(process.env.PORT) || 3000;
console.log(`Server starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
