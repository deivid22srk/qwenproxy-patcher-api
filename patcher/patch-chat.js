#!/usr/bin/env node
/**
 * Patch src/routes/chat.ts to support cookie-based mode without accounts.
 *
 * When no accounts are configured in the database (cookie-based mode),
 * the chatCompletions function would previously throw "All accounts failed"
 * because getNextAccount() returns null and the while(account) loop never runs.
 *
 * This patch adds a fallback that creates a virtual 'global' account from
 * the cookie configuration when no real accounts exist.
 */

const fs = require('fs');
const path = require('path');

const projectDir = process.argv[2] || process.cwd();
const chatPath = path.join(projectDir, 'src', 'routes', 'chat.ts');

if (!fs.existsSync(chatPath)) {
  console.error('  ✗ chat.ts not found at:', chatPath);
  process.exit(1);
}

let content = fs.readFileSync(chatPath, 'utf-8');

// The target: find `let account = getNextAccount();` and add fallback after it.
// Pattern:
//     let account = getNextAccount();
//     let triedAccountIds = new Set<string>();
//     let lastError: any = null;
//
// We insert after `let account = getNextAccount();`:
//     // Cookie-based mode: use virtual global account when no accounts in DB
//     if (!account) {
//       account = { id: 'global', email: 'cookies', password: '' };
//     }

const targetLine = "    let account = getNextAccount();";
const insertion = `\
    // Cookie-based mode: use virtual global account when no accounts in DB
    if (!account) {
      account = { id: 'global', email: 'cookies', password: '' };
    }
`;

// Check if already patched
if (content.includes('// Cookie-based mode: use virtual global account')) {
  console.log('  → chat.ts already patched (virtual account fallback present). Skipping.');
  process.exit(0);
}

const index = content.indexOf(targetLine);
if (index === -1) {
  console.log('  → Could not find target line in chat.ts. Trying alternate pattern...');

  // Try without the 4-space indent (some repos might use tabs or different spacing)
  const altPattern = "let account = getNextAccount();";
  const altIndex = content.indexOf(altPattern);
  if (altIndex === -1) {
    console.error('  ✗ Could not find `let account = getNextAccount()` in chat.ts. Patch failed.');
    process.exit(1);
  }

  // Insert after the matched line (find the end of the line)
  const lineEnd = content.indexOf('\n', altIndex);
  if (lineEnd === -1) {
    console.error('  ✗ Could not find end of line. Patch failed.');
    process.exit(1);
  }

  content = content.slice(0, lineEnd + 1) + insertion + content.slice(lineEnd + 1);
  console.log('  → Added virtual account fallback (alternate pattern)');
} else {
  // Insert after the matched line (find the end of the line)
  const lineEnd = content.indexOf('\n', index);
  if (lineEnd === -1) {
    console.error('  ✗ Could not find end of line. Patch failed.');
    process.exit(1);
  }

  content = content.slice(0, lineEnd + 1) + insertion + content.slice(lineEnd + 1);
  console.log('  → Added virtual account fallback for cookie-based mode');
}

fs.writeFileSync(chatPath, content);
console.log('  → chat.ts updated successfully');
