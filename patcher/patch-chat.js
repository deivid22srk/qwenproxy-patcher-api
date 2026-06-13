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

// Append the chatResponses function to the end of the file for Responses API compatibility
const chatResponsesCode = `

export async function chatResponses(c: Context) {
  try {
    const body = await c.req.json();
    
    // 1. Translate input/instructions into messages array
    const messages = Array.isArray(body.input) ? [...body.input] : (typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : []);
    if (body.instructions) {
      messages.unshift({ role: 'system', content: body.instructions });
    }
    
    // 2. Build the chat completions request body
    const chatCompletionsBody = {
      ...body,
      messages,
    };
    delete chatCompletionsBody.input;
    delete chatCompletionsBody.instructions;

    // 3. Create a mock context to pass to chatCompletions
    let mockJSONResponse: any = null;
    let mockStatus: number = 200;
    
    const mockContext = new Proxy(c, {
      get(target, prop, receiver) {
        if (prop === 'req') {
          return new Proxy(target.req, {
            get(reqTarget, reqProp) {
              if (reqProp === 'json') {
                return async () => chatCompletionsBody;
              }
              return Reflect.get(reqTarget, reqProp);
            }
          });
        }
        if (prop === 'json') {
          return (data: any, status: number = 200) => {
            mockJSONResponse = data;
            mockStatus = status;
            return target.json(data, status);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    // 4. Invoke chatCompletions
    const response = await chatCompletions(mockContext);
    
    // 5. If it returned a JSON response (non-streaming or error)
    if (mockJSONResponse) {
      if (mockJSONResponse.error) {
        return c.json(mockJSONResponse, mockStatus);
      }
      
      const finalContent = mockJSONResponse.choices?.[0]?.message?.content || '';
      const completionId = mockJSONResponse.id || ('resp-' + crypto.randomUUID());
      const model = mockJSONResponse.model || body.model;
      
      const responsesApiPayload: any = {
        id: completionId.startsWith('chatcmpl-') ? 'resp_' + completionId.slice(9) : 'resp_' + completionId,
        object: 'response',
        created_at: mockJSONResponse.created || Math.floor(Date.now() / 1000),
        model,
        output: [
          {
            id: 'msg_' + crypto.randomUUID(),
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: finalContent
              }
            ]
          }
        ]
      };

      const reasoning = mockJSONResponse.choices?.[0]?.message?.reasoning_content;
      if (reasoning) {
        responsesApiPayload.output.unshift({
          id: 'rs_' + crypto.randomUUID(),
          type: 'reasoning',
          content: [
            {
              type: 'reasoning_text',
              text: reasoning
            }
          ]
        });
      }

      return c.json(responsesApiPayload, mockStatus);
    }
    
    // 6. If it returned a streaming response (honoStream)
    if (response instanceof Response && response.body) {
      const chatStream = response.body;
      const reader = chatStream.getReader();
      const decoder = new TextDecoder();
      
      const completionId = 'resp_' + crypto.randomUUID();
      const assistantMsgId = 'msg_' + crypto.randomUUID();

      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache, no-transform');
      c.header('Connection', 'keep-alive');
      c.header('X-Accel-Buffering', 'no');

      return honoStream(c, async (streamWriter: any) => {
        streamWriter.write(\`data: \${JSON.stringify({
          type: 'response.created',
          response: {
            id: completionId,
            object: 'response',
            status: 'in_progress',
            model: body.model
          }
        })}\\n\\n\`);

        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;

              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') {
                continue;
              }

              try {
                const chunk = JSON.parse(dataStr);
                const deltaObj = chunk.choices?.[0]?.delta;
                
                if (deltaObj) {
                  if (deltaObj.content) {
                    streamWriter.write(\`data: \${JSON.stringify({
                      type: 'response.output_text.delta',
                      item_id: assistantMsgId,
                      output_index: 0,
                      content_index: 0,
                      delta: deltaObj.content
                    })}\\n\\n\`);
                  }
                }
              } catch (e) {
                // Ignore formatting noise
              }
            }
          }

          streamWriter.write(\`data: \${JSON.stringify({
            type: 'response.completed',
            response: {
              id: completionId,
              status: 'completed'
            }
          })}\\n\\n\`);
          streamWriter.write('data: [DONE]\\n\\n');

        } catch (err) {
          console.error('[Responses API Stream Error]:', err);
        } finally {
          reader.releaseLock();
        }
      });
    }

    return response;
  } catch (err: any) {
    console.error('Error in chatResponses:', err);
    return c.json({ error: err.message }, 500);
  }
}
`;

content += chatResponsesCode;

// Add safety check to prevent crash during tool formatting if t.function is undefined
content = content.replace(
  "if (t.type === 'function') {",
  "if (t.type === 'function' && t.function) {"
);

fs.writeFileSync(chatPath, content);
console.log('  → chat.ts updated successfully');
