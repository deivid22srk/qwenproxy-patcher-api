import type { Context } from 'hono';
import crypto from 'crypto';
import { createQwenStream, RetryableQwenStreamError } from '../services/qwen.js';
import type { OpenAIRequest } from '../utils/types.js';
import { getModelContextWindow } from '../core/model-registry.js'
import { truncateMessages, estimateTokenCount } from '../utils/context-truncation.js';
import { getNextAccount, getNextAvailableAccount, markAccountRateLimited, getAccountCooldownInfo, markAccountInUse, releaseAccountInUse, getInUseAccounts } from '../core/account-manager.js';
import { loadAccounts } from '../core/accounts.js';
import { registerStream, removeStream, getStream } from '../core/stream-registry.js';
import { metrics } from '../core/metrics.js'
import {
  getForcedToolName,
  getRecentToolNames,
  selectCandidateTools,
  buildCompactToolManifest,
  buildToolCallContract,
  getToolChoiceMode,
} from './tool-handler.js';
import { handleStreamingResponse, handleNonStreamingResponse } from './stream-handler.js';

export { getIncrementalDelta } from './sse-parser.js';
export type { DeltaResult } from './sse-parser.js';

export async function chatCompletions(c: Context) {
  try {
    const body: OpenAIRequest = await c.req.json();
    const isStream = body.stream ?? false;
    
    let prompt = '';
    const messages = body.messages || [];
    let systemPrompt = '';
    const pendingMultimodal: Array<Array<{ type: string; text?: string; image_url?: { url: string }; video_url?: { url: string }; audio_url?: { url: string }; file_url?: { url: string } }>> = [];

    const toolCallIdToName = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray((msg as any).tool_calls)) {
        for (const tc of (msg as any).tool_calls) {
          if (tc.id && tc.function?.name) {
            toolCallIdToName.set(tc.id, tc.function.name);
          }
        }
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      let contentStr = '';
      if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        const multimodalParts: Array<{ type: string; text?: string; image_url?: { url: string }; video_url?: { url: string }; audio_url?: { url: string }; file_url?: { url: string } }> = [];
        
        for (const p of msg.content as any[]) {
          if (p.type === "text" && p.text) {
            textParts.push(p.text);
          } else if (
            (p.type === "image_url" && p.image_url?.url) ||
            (p.type === "video_url" && p.video_url?.url) ||
            (p.type === "audio_url" && p.audio_url?.url) ||
            (p.type === "file_url" && p.file_url?.url)
          ) {
            multimodalParts.push(p);
          }
        }
        
        contentStr = textParts.join("\n");
        if (multimodalParts.length > 0) {
          pendingMultimodal.push(multimodalParts);
        }
      } else if (typeof msg.content === 'object' && msg.content !== null) {
        contentStr = JSON.stringify(msg.content);
      } else {
        contentStr = msg.content || '';
      }

      if (msg.role === 'system') {
        systemPrompt += (contentStr || '') + '\n\n';
      } else if (msg.role === 'user') {
        prompt += `User: ${contentStr || ''}\n\n`;
      } else if (msg.role === 'assistant') {
        let assistantContent = contentStr || '';
        const reasoning = (msg as any).reasoning_content;
        if (reasoning) {
          assistantContent = `<think>\n${reasoning}\n</think>\n${assistantContent}`;
        }
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
           for (const tc of msg.tool_calls) {
             const args = tc.function?.arguments;
             let parsedArgs: any = {};
             if (typeof args === 'string') {
               try { parsedArgs = JSON.parse(args); } catch { parsedArgs = {}; }
             } else if (args && typeof args === 'object') {
               parsedArgs = args;
             }
             const payload = { name: tc.function?.name, arguments: parsedArgs };
             const toolCallStr = `\n<tool_call>\n${JSON.stringify(payload)}\n</tool_call>`;
             assistantContent = assistantContent ? assistantContent + toolCallStr : toolCallStr.trim();
           }
        }
        prompt += `Assistant: ${assistantContent.trim()}\n\n`;
      } else if (msg.role === 'tool' || msg.role === 'function') {
        let toolName = msg.name;
        if (!toolName && msg.tool_call_id) {
          toolName = toolCallIdToName.get(msg.tool_call_id);
        }
        prompt += `Tool Response (${toolName || 'tool'}): ${contentStr || ''}\n`;
      }
    }

    const bodyAny = body as any;
    const hasTools = Array.isArray(bodyAny.tools) && bodyAny.tools.length > 0;
    const toolChoiceMode = getToolChoiceMode(bodyAny.tool_choice);
    if (hasTools && toolChoiceMode !== 'none') {
      const formattedTools = bodyAny.tools.map((t: any) => {
        if (t.type === 'function' && t.function) {
          return {
            name: t.function.name,
            description: t.function.description || '',
            parameters: t.function.parameters
          };
        }
        return t;
      });
      const toolsJson = JSON.stringify(formattedTools);
      
      systemPrompt += `\n\n# TOOLS AVAILABLE\nYou have access to the following tools:\n${toolsJson}\n\n# TOOL CALLING FORMAT (MANDATORY)\nTo use a tool, you MUST output a JSON object wrapped EXACTLY in <tool_call> tags:\n\n<tool_call>\n{"name": "tool_name", "arguments": {"param_name": "value"}}\n</tool_call>\n\nEXAMPLE OF MULTIPLE TOOL CALLS:\n<tool_call>\n{"name": "read_file", "arguments": {"path": "file1.txt"}}\n</tool_call>\n<tool_call>\n{"name": "read_file", "arguments": {"path": "file2.txt"}}\n</tool_call>\n\nCRITICAL RULES:\n1. ONLY use the tags above for tool calling. NEVER output raw JSON without tags.\n2. You can call multiple tools by outputting multiple <tool_call> blocks consecutively.\n3. Do NOT output any other text (explanations, chat, etc.) after your <tool_call> blocks. Wait for the user to provide the tool response.\n4. The JSON inside the tags MUST be valid and include ALL required braces and the "arguments" field.\n5. If you need to use a tool, do it IMMEDIATELY without preamble.\n6. NEVER invent, guess, or hallucinate tool names. You MUST ONLY use the exact tool names provided in the 'TOOLS AVAILABLE' list above. Calling an unlisted tool will result in a hard execution error.\n\n`;
      
      if (bodyAny.tool_choice && typeof bodyAny.tool_choice === 'object' && bodyAny.tool_choice.function) {
        const forcedTool = bodyAny.tool_choice.function.name;
        systemPrompt += `CRITICAL: You MUST call the tool "${forcedTool}" in this response.\n\n`;
      }
    }

    const modelId = body.model.replace('-no-thinking', '').replace('-thinking', '');
    const modelContextWindow = getModelContextWindow(modelId)
    const estimatedTokens = estimateTokenCount(systemPrompt + prompt, modelId);
    const forcedToolName = getForcedToolName(bodyAny.tool_choice);
    const parallelToolCalls = bodyAny.parallel_tool_calls !== false && toolChoiceMode !== 'forced';
    const toolContextText = `${systemPrompt}\n${prompt}`;
    const recentToolNames = hasTools ? getRecentToolNames(messages) : new Set<string>();
    const candidateTools = hasTools ? selectCandidateTools(bodyAny.tools, toolContextText, forcedToolName, recentToolNames) : [];
    
    let finalPrompt: string;
    if (estimatedTokens > modelContextWindow - 1000) {
      const truncated = truncateMessages(messages, modelContextWindow, systemPrompt, modelId);
      const truncatedBody = truncated.map(m => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role}: ${m.content}`).join('\n\n');
      finalPrompt = systemPrompt ? `${systemPrompt}\n\n${truncatedBody}` : truncatedBody;
    } else {
      finalPrompt = systemPrompt ? `${systemPrompt}\n${prompt}` : prompt;
    }

    if (hasTools && toolChoiceMode === 'none') {
      finalPrompt += '\n\n[TOOL USE DISABLED]\nDo not call tools in this response. Answer directly using available context.';
    }

    if (hasTools && toolChoiceMode !== 'none') {
      const compactManifest = buildCompactToolManifest(candidateTools, forcedToolName);
      const toolContract = buildToolCallContract(candidateTools, forcedToolName, parallelToolCalls);
      finalPrompt += `\n\n${toolContract}`;
      if (compactManifest) finalPrompt += `\n\n${compactManifest}`;
    }

    const isThinkingModel = !body.model.includes('no-thinking');

    const isGuestModeOnly = process.env.QWEN_GUEST_MODE_ONLY?.toLowerCase() === 'true';
    let stream: ReadableStream | undefined;
    let uiSessionId = '';
    const completionId = 'chatcmpl-' + crypto.randomUUID();
    let lastError: any = null;

    if (isGuestModeOnly) {
      console.log('[Chat] Guest mode only enabled. Bypassing account rotation.');
      try {
        const result = await createQwenStream(
          finalPrompt,
          isThinkingModel,
          body.model,
          null,
          'guest',
          undefined,
          pendingMultimodal.length > 0 ? pendingMultimodal : undefined
        );
        stream = result.stream;
        uiSessionId = result.uiSessionId;
        registerStream(completionId, {
          abortController: result.controller,
          accountId: 'guest',
          uiSessionId: result.uiSessionId,
          targetResponseId: '',
          headers: result.headers,
        });
      } catch (err: any) {
        console.error('[Chat] Guest mode failed:', err.message);
        throw err;
      }
    } else {
      let account = getNextAccount();
    // Cookie-based mode: use virtual global account when no accounts in DB
    if (!account) {
      account = { id: 'global', email: 'cookies', password: '' };
    }
      const triedAccountIds = new Set<string>();

      if (!account) {
        const inUse = getInUseAccounts();
        const message = inUse.length > 0
          ? `All configured account lanes are busy: ${inUse.join(', ')}`
          : 'No available account lanes';
        throw new RetryableQwenStreamError(message, 1000);
      }

      while (account) {
        const accountId = account.id;
        const accountEmail = account.email;

        if (triedAccountIds.has(accountId)) {
          account = getNextAvailableAccount(triedAccountIds);
          continue;
        }
        triedAccountIds.add(accountId);

        const cooldownInfo = getAccountCooldownInfo(accountId);
        if (cooldownInfo && accountId !== 'global') {
          console.log(`[Chat] Skipping account ${accountEmail} (${accountId}) — on cooldown for ${Math.round(cooldownInfo.remainingMs / 1000)}s (${cooldownInfo.reason})`);
          account = getNextAvailableAccount(triedAccountIds);
          continue;
        }

        console.log(`[Chat] Routing request to account: ${accountEmail} (${accountId})`);
        markAccountInUse(accountId);

        let retries = 3;
        let retryDelay = 500;
        let success = false;

        try {
          while (retries > 0) {
            try {
              const result = await createQwenStream(
                finalPrompt,
                isThinkingModel,
                body.model,
                null,
                accountId === 'global' ? undefined : accountId,
                undefined,
                pendingMultimodal.length > 0 ? pendingMultimodal : undefined
              );
              stream = result.stream;
              uiSessionId = result.uiSessionId;
              registerStream(completionId, {
                abortController: result.controller,
                accountId: result.accountId,
                uiSessionId: result.uiSessionId,
                targetResponseId: '',
                headers: result.headers,
              });
              success = true;
              break;
            } catch (err: any) {
              retries--;

              if (err.upstreamCode === 'RateLimited' || err.upstreamStatus === 429) {
                const hourHint = err.message?.match(/Wait about (\d+) hour/);
                const hours = hourHint ? parseInt(hourHint[1]) : 24;
                const cooldownMs = hours * 60 * 60 * 1000;
                markAccountRateLimited(accountId, cooldownMs, 'RateLimited');
                console.warn(`[Chat] Account ${accountEmail} (${accountId}) rate-limited. Entering cooldown for ${hours} hours.`);
                lastError = err;
                break;
              }

              if (retries === 0) {
                if (err.upstreamStatus && err.upstreamStatus >= 500) {
                  markAccountRateLimited(accountId, undefined, 'ServerError');
                  console.warn(`[Chat] Account ${accountEmail} (${accountId}) returned server error. Marked for cooldown.`);
                }
                lastError = err;
                break;
              }

              let useDelay = retryDelay;
              if (err instanceof RetryableQwenStreamError && err.retryAfterMs !== undefined) {
                useDelay = err.retryAfterMs;
              }
              const isRetryable = err instanceof RetryableQwenStreamError || err.message?.includes('in progress') || err.message?.includes('Bad_Request');
              if (!isRetryable) {
                lastError = err;
                break;
              }
              console.warn(`[Chat] Qwen request failed for ${accountEmail}, retrying in ${useDelay}ms... (${retries} left)`);
              await new Promise(r => setTimeout(r, useDelay));
              retryDelay = Math.min(retryDelay * 2, 5000);
            }
          }
        } finally {
          if (!success) {
            releaseAccountInUse(accountId);
          }
        }

        if (success) {
          break;
        }

        account = getNextAvailableAccount(triedAccountIds);
      }
    }

    if (!stream) {
      removeStream(completionId);
      const accounts = loadAccounts();
      const allOnCooldown = accounts.length === 0 || accounts.every(a => getAccountCooldownInfo(a.id) !== null);
      
      if (allOnCooldown) {
        console.warn(`[Chat] CRITICAL: All accounts are rate-limited, on cooldown, or none configured! Falling back to GUEST mode.`);
        try {
          const result = await createQwenStream(
            finalPrompt,
            isThinkingModel,
            body.model,
            null,
            'guest',
            undefined,
            pendingMultimodal.length > 0 ? pendingMultimodal : undefined
          );
          stream = result.stream;
          uiSessionId = result.uiSessionId;
          registerStream(completionId, {
            abortController: result.controller,
            accountId: 'guest',
            uiSessionId: result.uiSessionId,
            targetResponseId: '',
            headers: result.headers,
          });
        } catch (guestErr: any) {
          console.error('[Chat] Guest mode also failed:', guestErr.message);
          throw lastError || new Error('All accounts and guest mode failed');
        }
      } else {
        throw lastError || new Error('All accounts failed');
      }
    }

    if (!isStream) {
      return handleNonStreamingResponse(c, stream!, completionId, body.model, uiSessionId, hasTools && toolChoiceMode !== 'none', bodyAny.tools || []);
    }

    return handleStreamingResponse(c, {
      stream: stream!,
      completionId,
      model: body.model,
      uiSessionId,
      hasTools: hasTools && toolChoiceMode !== 'none',
      tools: bodyAny.tools || [],
      finalPrompt,
      streamOptions: body.stream_options
    });
  } catch (err: any) {
    console.error('Error in chatCompletions:', err)
    const status = err.upstreamStatus || 500
    if (status >= 500) {
      metrics.increment('requests.errors')
    }
    return c.json({ error: { message: err.message } }, status)
  }
}

export async function chatCompletionsStop(c: Context) {
  try {
    const body = await c.req.json();
    const { chat_id, response_id } = body;

    if (!chat_id || !response_id) {
      return c.json({ error: 'chat_id and response_id are required' }, 400);
    }

    const stream = getStream(chat_id);
    if (!stream) {
      return c.json({ error: 'Stream not found' }, 404);
    }

    if (stream.targetResponseId && stream.targetResponseId !== response_id) {
      return c.json({ error: 'response_id mismatch' }, 400);
    }

    const stopResponse = await fetch(`https://chat.qwen.ai/api/v2/chat/completions/stop?chat_id=${chat_id}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Content-Type': 'application/json',
        'Cookie': stream.headers.cookie,
        'Origin': 'https://chat.qwen.ai',
        'Referer': `https://chat.qwen.ai/c/${chat_id}`,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': stream.headers['user-agent'],
        'X-Request-Id': crypto.randomUUID(),
        'bx-ua': stream.headers['bx-ua'],
        'bx-umidtoken': stream.headers['bx-umidtoken'],
        'bx-v': stream.headers['bx-v'],
      },
      body: JSON.stringify({ chat_id, response_id }),
    });

    if (!stopResponse.ok) {
      const errorText = await stopResponse.text();
      console.error(`[Stop] Failed to stop generation for chat_id=${chat_id}: ${stopResponse.status} ${errorText}`);
      return c.json({ error: 'Failed to stop generation' }, stopResponse.status as any);
    }

    stream.abortController.abort();
    removeStream(chat_id);

    console.log(`[Stop] Generation stopped for chat_id=${chat_id}`);
    return c.json({ success: true });
  } catch (err: any) {
    console.error('Error in chatCompletionsStop:', err);
    return c.json({ error: err.message }, 500);
  }
}


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
        streamWriter.write(`data: ${JSON.stringify({
          type: 'response.created',
          response: {
            id: completionId,
            object: 'response',
            status: 'in_progress',
            model: body.model
          }
        })}\n\n`);

        let buffer = '';
        let isThinking = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
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
                  if (deltaObj.reasoning_content) {
                    let textToWrite = '';
                    if (!isThinking) {
                      textToWrite += '<think>\n';
                      isThinking = true;
                    }
                    textToWrite += deltaObj.reasoning_content;
                    
                    streamWriter.write(`data: ${JSON.stringify({
                      type: 'response.output_text.delta',
                      item_id: assistantMsgId,
                      output_index: 0,
                      content_index: 0,
                      delta: textToWrite
                    })}\n\n`);
                  }
                  
                  if (deltaObj.content) {
                    let textToWrite = '';
                    if (isThinking) {
                      textToWrite += '\n</think>\n';
                      isThinking = false;
                    }
                    textToWrite += deltaObj.content;
                    
                    streamWriter.write(`data: ${JSON.stringify({
                      type: 'response.output_text.delta',
                      item_id: assistantMsgId,
                      output_index: 0,
                      content_index: 0,
                      delta: textToWrite
                    })}\n\n`);
                  }
                }
              } catch (e) {
                // Ignore formatting noise
              }
            }
          }

          streamWriter.write(`data: ${JSON.stringify({
            type: 'response.completed',
            response: {
              id: completionId,
              status: 'completed'
            }
          })}\n\n`);
          streamWriter.write('data: [DONE]\n\n');

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
