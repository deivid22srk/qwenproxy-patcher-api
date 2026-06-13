#!/usr/bin/env node
/**
 * Patch src/api/server.ts to use cookie-based initialization
 * instead of Playwright browser initialization.
 */

const fs = require('fs');
const path = require('path');

const projectDir = process.argv[2] || process.cwd();
const serverPath = path.join(projectDir, 'src', 'api', 'server.ts');

if (!fs.existsSync(serverPath)) {
  console.error('  ✗ server.ts not found at:', serverPath);
  process.exit(1);
}

let content = fs.readFileSync(serverPath, 'utf-8');

// Find and replace the Playwright initialization block
// The original code looks like this (no semicolons):
//
//   if (accounts.length > 0) {
//     console.log(`[Server] Pre-warming ${accounts.length} configured account(s)...`)
//     const { initPlaywrightForAccount } = await import('../services/playwright.ts')
//     for (const account of accounts) {
//       try {
//         await initPlaywrightForAccount(account, config.browser.headless)
//       } catch (err: any) {
//         console.error(`[Server] Failed to initialize account ${account.email}:`, err.message)
//       }
//     }
//   } else {
//     const { initPlaywright } = await import('../services/playwright.ts')
//     await initPlaywright(config.browser.headless)
//   }

// Look for the specific pattern - no semicolons
// Match from "if (accounts.length > 0) {" to the closing "}" of the else block
const oldBlockMatch = content.match(
    /if \(accounts\.length > 0\) \{[\s\S]*?await initPlaywright\(config\.browser\.headless\)\s*\n\s*\}/
);

if (oldBlockMatch) {
  const newBlock = [
    '  if (accounts.length > 0) {',
    "    console.log('[Server] Using ' + accounts.length + ' configured account(s) with cookie-based auth...')",
    "    const { initPlaywrightForAccount } = await import('../services/playwright.ts')",
    '    for (const account of accounts) {',
    '      try {',
    '        await initPlaywrightForAccount(account, config.browser.headless)',
    '      } catch (err: any) {',
    "        console.error('[Server] Failed to initialize account ' + account.email + ':', err.message)",
    '      }',
    '    }',
    '  } else {',
    "    const { initPlaywright } = await import('../services/playwright.ts')",
    "    console.log('[Server] No accounts configured. Initializing cookie-based mode...')",
    '    await initPlaywright(config.browser.headless)',
    '  }'
  ].join('\n');

  content = content.replace(oldBlockMatch[0], newBlock);
  console.log('  → Updated Playwright initialization block');
} else {
  console.log('  → Could not find Playwright init block in server.ts');
}

// Replace closePlaywright import path (.js → .ts for consistency)
content = content.replace(
  "const { closePlaywright } = await import('../services/playwright.js')",
  "const { closePlaywright } = await import('../services/playwright.ts')"
);

fs.writeFileSync(serverPath, content);
console.log('  → server.ts updated successfully');
