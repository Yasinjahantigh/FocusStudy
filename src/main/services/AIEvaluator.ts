import { AIJustificationRequest, AIJustificationResult, EnvironmentAuditItem, AISettings, AppVerdict, AppCategory, CategorizationRule, EvidenceSource, DecisionSource } from '../../shared/types';
import { assessApp, appFingerprint, domainMatches, normalizeExecutableName, isAIAssistant } from '../../shared/classification';
import { searchWeb } from './webSearch';
import { GoogleGenAI, type Part as GooglePart } from '@google/genai';

const LLM_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 10_000;
const MAX_TOOL_ROUNDS = 2;
const REVIEW_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GOOGLE_GENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type CachedReview = {
  verdict: AppVerdict;
  reason: string;
  confidence: number;
  source: DecisionSource;
  sources: EvidenceSource[];
  expiresAt: number;
};
const reviewCache = new Map<string, CachedReview>();

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'search_web',
    description:
      'Search the web for current or factual information the assistant does not know. Use it whenever answering requires up-to-date data or a topic outside the model knowledge. Returns a JSON array of {title, url, snippet} results.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query, concise and keyword-based (e.g. "integral of 1/(1+x^2) steps")',
        },
      },
      required: ['query'],
    },
  },
};

/** True when the configured baseUrl is a Google Gen AI (AI Studio) endpoint. */
function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || GOOGLE_GENAI_BASE_URL).trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(raw);
    // The Google OpenAI-compatible path (`/v1beta/openai`) is not the native
    // Gen AI SDK endpoint. Normalize legacy settings to the SDK root so search
    // grounding and Gemma work through the supported API.
    if (parsed.hostname.toLowerCase() === 'generativelanguage.googleapis.com') {
      return GOOGLE_GENAI_BASE_URL;
    }
  } catch {
    // Let the normal request path report an invalid custom endpoint.
  }
  return raw;
}

function isGoogleSdkUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}

/**
 * Google Gen AI SDK path (generativelanguage.googleapis.com). Uses the official
 * @google/genai library so native function calling and server-side web search
 * grounding (`googleSearch` tool + `search_web` function declaration) work
 * out of the box — including for Gemma models on Google's API, where OpenAI-
 * style tool calls are unreliable. Falls back to a plain (tool-less) call if
 * the endpoint rejects the tools config.
 */
async function chatCompletionGoogle(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
  temperature = 0.2,
  searchEnabled = false,
  onToolCall?: (toolName: string) => void,
  onError?: (message: string) => void
): Promise<unknown | null> {
  const ai = new GoogleGenAI({ apiKey });

  let systemInstruction = '';
  const contents: { role: 'user' | 'model'; parts: GooglePart[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemInstruction += (systemInstruction ? '\n' : '') + (m.content ?? '');
      continue;
    }
    if (m.role === 'tool') {
      let parsed: unknown = m.content;
      try {
        parsed = m.content ? JSON.parse(m.content) : {};
      } catch {
        parsed = m.content || {};
      }
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.name || 'search_web',
              response: { results: String(parsed) },
            },
          },
        ],
      });
      continue;
    }
    const parts: GooglePart[] = [];
    if (m.content) parts.push({ text: m.content });
    if (m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: tc.function.name, args } });
      }
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }

  const generate = async (includeTools: boolean) => {
    const config: Record<string, unknown> = {
      temperature,
      maxOutputTokens: 2000,
    };
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (includeTools && searchEnabled) {
      // Gemma on the Gemini API supports the native Google Search grounding
      // tool. Do not combine it with an OpenAI-style function declaration: the
      // API rejects that mixed tool configuration for Gemma models.
      config.tools = [{ googleSearch: {} }];
    }
    return ai.models.generateContent({ model, contents, config } as never);
  };

  // The SDK has no per-call timeout; enforce one with Promise.race.
  const withTimeout = async <T>(promise: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Google API call timed out')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  let includeTools = searchEnabled;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let res: Awaited<ReturnType<typeof generate>>;
    try {
      res = await withTimeout(generate(includeTools));
    } catch (err: any) {
      if (includeTools) {
        console.warn(`[AIEvaluator] Google API rejected tools (${err?.message || err}); retrying without tools.`);
        includeTools = false;
        continue;
      }
      const message = err?.message || String(err);
      onError?.(message);
      console.warn('[AIEvaluator] Google API call failed:', err);
      return null;
    }

    const parts: GooglePart[] = res?.candidates?.[0]?.content?.parts ?? [];
    const groundingMetadata = res?.candidates?.[0]?.groundingMetadata;

    // Server-side web search grounding ran (googleSearch tool).
    const grounded = !!groundingMetadata?.groundingChunks || !!groundingMetadata?.searchEntryPoint;
    if (grounded) onToolCall?.('google_search');

    // Native function calls (search_web declaration).
    const fnCalls = (parts.filter(p => p.functionCall) as GooglePart[]).map(p => p.functionCall);
    if (fnCalls.length > 0) {
      const responses: GooglePart[] = [];
      for (const fc of fnCalls) {
        const fnName = fc?.name || '';
        const query = String((fc?.args as Record<string, unknown> | undefined)?.query || '').trim();
        if (fnName === 'search_web') {
          onToolCall?.('search_web');
          responses.push({
            functionResponse: {
              name: fnName,
              response: { results: await searchWeb(query), query },
            },
          });
        } else {
          responses.push({ functionResponse: { name: fnName, response: { results: [] } } });
        }
      }
      contents.push({ role: 'model', parts });
      contents.push({ role: 'user', parts: responses });
      continue;
    }

    const text = (typeof (res as any)?.text === 'string'
      ? (res as any).text
      : parts.map(p => (typeof p.text === 'string' ? p.text : '')).join('\n')).trim();
    if (!text) {
      onError?.('Google returned no text content. Check that the selected model is available for this API key.');
      return null;
    }
    const parsed = parseLenientJson(text);
    if (parsed === null) {
      onError?.(`Google returned non-JSON output: ${text.slice(0, 180)}`);
    }
    return parsed;
  }

  return null;
}

/**
 * Extracts Gemma-style text tool calls (`<|tool_call|>call:name{json}<tool_call|>`)
 * since local Gemma models emit tool calls as plain text rather than structured
 * `tool_calls` arrays. Returns ALL calls found in the content so the audit can
 * identify several unknown apps in one round.
 */
function extractGemmaToolCalls(text: string): { name: string; argsJson: string }[] {
  const calls: { name: string; argsJson: string }[] = [];
  const regex = /<\|tool_call\|>\s*call:([a-zA-Z_]+)\s*(\{[^}]*\})?\s*<\|tool_call\|>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    calls.push({ name: match[1].trim(), argsJson: match[2] || '{}' });
  }
  return calls;
}

function formatSearchResults(query: string, results: { title: string; url: string; snippet: string }[]): string {
  if (!results || results.length === 0) {
    return `Search for "${query}" returned no results.`;
  }
  return (
    `Web search results for "${query}":\n` +
    results
      .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
      .join('\n\n')
  );
}

/**
 * Calls an OpenAI-compatible chat completions endpoint with a hard timeout and
 * (when `searchEnabled`) a `search_web` tool. Tool calls issued by the model —
 * both structured OpenAI format and Gemma text-format — are executed locally
 * via DuckDuckGo and fed back to the model in a follow-up round.
 * For Google-hosted endpoints (generativelanguage.googleapis.com) the
 * `google_search` built-in tool is used instead; grounding then runs server-side.
 * Returns parsed JSON content or null on any failure (caller decides fallback).
 */
async function chatCompletion(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  timeoutMs: number,
  temperature = 0.2,
  searchEnabled = false,
  onToolCall?: (toolName: string) => void,
  onError?: (message: string) => void
): Promise<unknown | null> {
  const isGoogleEndpoint = isGoogleSdkUrl(baseUrl);
  if (isGoogleEndpoint) {
    return chatCompletionGoogle(apiKey, model, messages, timeoutMs, temperature, searchEnabled, onToolCall, onError);
  }

  const initialMessages: ChatMessage[] = messages.map(m => {
    const clean: ChatMessage = { role: m.role, content: m.content ?? '' };
    if (m.tool_calls) clean.tool_calls = m.tool_calls;
    if (m.tool_call_id) clean.tool_call_id = m.tool_call_id;
    return clean;
  });

  const postBody = (msgs: unknown[], includeTools: boolean) => {
    const body: Record<string, unknown> = {
      model,
      messages: msgs,
      temperature,
      max_tokens: 2000,
    };
    if (includeTools && searchEnabled) {
      body.tools = [SEARCH_TOOL];
    }
    return body;
  };

  const sendOnce = async (msgs: unknown[], includeTools: boolean): Promise<any> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(postBody(msgs, includeTools)),
        signal: controller.signal,
      });

      if (response.status === 400 && includeTools) {
        // Endpoint does not understand our tools declaration — retry plain.
        return sendOnce(msgs, false);
      }
      if (!response.ok) {
        const message = `LLM API responded ${response.status}`;
        onError?.(message);
        console.warn(`[AIEvaluator] ${message}`);
        return null;
      }
      return await response.json();
    } catch (err: any) {
      onError?.(err?.message || String(err));
      console.warn('[AIEvaluator] LLM API call failed:', err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const history: ChatMessage[] = [...(initialMessages as ChatMessage[])];
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const data = await sendOnce(history, round === 0);
    if (data === null) return null;

    const message = data?.choices?.[0]?.message;
    if (!message) return null;

    const contentText: string | null = typeof message.content === 'string' ? message.content : null;
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : null;

    // 1) Structured OpenAI-format tool calls.
    if (toolCalls && toolCalls.length > 0) {
      const toolMessages: ChatMessage[] = [];
      for (const tc of toolCalls) {
        const name = tc?.function?.name;
        if (name === 'search_web') {
          let query = '';
          try {
            query = String(JSON.parse(tc.function.arguments || '{}').query || '').trim();
          } catch {
            query = '';
          }
          toolMessages.push({
            role: 'tool',
            tool_call_id: String(tc.id || `call_${round}`),
            content: formatSearchResults(query, await searchWeb(query)),
          });
          onToolCall?.('search_web');
        }
      }
      if (toolMessages.length > 0) {
        history.push(message as ChatMessage);
        history.push(...toolMessages);
        continue;
      }
      console.warn('[AIEvaluator] Model requested unknown tool call; ignoring.');
    }

    // 2) Gemma-style text tool calls inside the content (possibly several).
    if (!toolCalls && contentText) {
      const gemmaCalls = extractGemmaToolCalls(contentText);
      const searchCalls = gemmaCalls.filter(c => c.name === 'search_web');
      if (searchCalls.length > 0) {
        const parts: string[] = [];
        for (const call of searchCalls) {
          let query = '';
          try {
            query = String(JSON.parse(call.argsJson).query || '').trim();
          } catch {
            query = '';
          }
          parts.push(formatSearchResults(query, await searchWeb(query)));
        }
        onToolCall?.('search_web');
        history.push({ role: 'assistant', content: contentText });
        history.push({
          role: 'user',
          content:
            parts.join('\n\n') +
            '\n\nBased on these search results, produce the final answer now. Return ONLY raw JSON as requested in the original instructions.',
        });
        continue;
      }
    }

    // 3) Final answer.
    if (typeof contentText !== 'string' || !contentText.trim()) return null;
    const parsed = parseLenientJson(contentText);
    if (parsed === null) {
      onError?.(`Model returned non-JSON output: ${contentText.slice(0, 180)}`);
    }
    return parsed;
  }

  return null;
}

/**
 * Parses JSON from LLM output tolerantly: strict parse first, then extract
 * the first JSON array or object via regex and try again.
 */
export function parseLenientJson(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to extraction
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // fall through
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Verifies that the configured endpoint responds to a minimal chat request.
 * Used by the settings screen "Test Connection" button.
 */
export async function testConnection(aiSettings?: AISettings): Promise<{ ok: boolean; message: string }> {
  if (!aiSettings || !aiSettings.apiKey || !aiSettings.apiKey.trim()) {
    return { ok: false, message: 'API key is not set. Please configure the key first.' };
  }

  const baseUrl = normalizeBaseUrl(aiSettings.baseUrl);
  const model = aiSettings.model || 'gemma-4-31b-it';
  let requestError = '';

  try {
    const result = await chatCompletion(
      baseUrl,
      model,
      aiSettings.apiKey,
      [
        { role: 'system', content: 'You are a connectivity test. Return only strict JSON.' },
        { role: 'user', content: 'Ping: return {"ok":true}' },
      ],
      TEST_TIMEOUT_MS,
      0,
      !!aiSettings.searchEnabled,
      undefined,
      message => { requestError = message; }
    );

    if (result === null) {
      return {
        ok: false,
        message: requestError
          ? `AI request failed (${baseUrl}): ${requestError}`
          : `No valid JSON response from ${baseUrl}. Check URL, model and key.`,
      };
    }
    return { ok: true, message: `Connection OK — model "${model}" responded.` };
  } catch (err: any) {
    return { ok: false, message: `Connection failed: ${err?.message || String(err)}` };
  }
}

/**
 * Probes whether the configured model can actually use web search through our
 * tool loop. Sends a question that requires fresh web data and reports whether
 * the model issued a `search_web` call (or Google-hosted grounding) and whether
 * it still produced a valid answer afterwards. Reports which backend was used
 * (Google Gen AI SDK vs OpenAI-compatible) so the user understands the path.
 */
export async function testAISearch(aiSettings?: AISettings): Promise<{
  ok: boolean;
  searched: boolean;
  mode: 'google-sdk' | 'openai';
  message: string;
}> {
  if (!aiSettings || !aiSettings.searchEnabled) {
    return { ok: false, searched: false, mode: 'openai', message: 'Web search for AI is disabled. Enable it in settings first.' };
  }
  if (!aiSettings.apiKey || !aiSettings.apiKey.trim()) {
    return { ok: false, searched: false, mode: 'openai', message: 'API key is not set. Please configure the key first.' };
  }

  const baseUrl = normalizeBaseUrl(aiSettings.baseUrl);
  const model = aiSettings.model || 'gemma-4-31b-it';
  const mode = isGoogleSdkUrl(baseUrl) ? 'google-sdk' : 'openai';
  let searched = false;
  let requestError = '';

  try {
    const result = await chatCompletion(
      baseUrl,
      model,
      aiSettings.apiKey,
      [
        {
          role: 'system',
          content: 'You are a strict JSON-only assistant. Never output markdown or prose.',
        },
        {
          role: 'user',
          content:
            'Use the search tool to look up current information (e.g. the current President of Iran in 2026), then answer. Return ONLY raw JSON: {"answer": "..."}',
        },
      ],
      LLM_TIMEOUT_MS,
      0.2,
      true,
      () => {
        searched = true;
      },
      message => { requestError = message; }
    );

    if (result === null) {
      return {
        ok: false,
        searched,
        mode,
        message: searched
          ? 'Search was executed but no valid answer came back (model failed to resume after tool use).'
          : requestError
            ? `Search request failed: ${requestError}`
          : mode === 'google-sdk'
            ? `Model "${model}" answered without using search grounding. Make sure this model supports the googleSearch tool (Gemini models do; some Gemma/other models on the API may not).
Recommendation: use a Gemini model on Google's endpoint, or a local model that supports tool calling.`
            : `Model "${model}" did not use the search tool. It may not support function/tool calling (common for some local Gemma builds). Try: (1) a tool-capable model like Qwen3, (2) Ollama's native tools support, (3) the "tooltalk" middleware for Gemma, or (4) switching this Base URL to Google's Gen AI endpoint (generativelanguage.googleapis.com/v1beta) where the Google SDK handles search natively.`,
      };
    }
    return {
      ok: true,
      searched,
      mode,
      message: searched
        ? mode === 'google-sdk'
          ? 'Search works: Google Gen AI SDK handled web search (native grounding/function calling) and the model answered.'
          : 'Search works: the model issued a search_web call and answered with results.'
        : 'Connection OK, but the model answered without searching (it may rely on built-in knowledge).',
    };
  } catch (err: any) {
    return { ok: false, searched, mode, message: `Search test failed: ${err?.message || String(err)}` };
  }
}

export class AIEvaluator {
  /** Reliable audit path. Local rules/system signals are authoritative; only
   * genuinely unknown items are sent to search/AI. */
  public static async auditEnvironmentReliable(
    apps: { appName: string; title: string; execPath?: string; domain?: string }[],
    subject: string,
    allowedApps: string[],
    aiSettings?: AISettings,
    lang: 'en' | 'fa' = 'fa',
    categories: AppCategory[] = [],
    rules: CategorizationRule[] = []
  ): Promise<EnvironmentAuditItem[]> {
    const allowedMatch = (app: typeof apps[number]) => (allowedApps || []).some(raw => {
      const value = String(raw || '').trim().toLowerCase();
      if (!value) return false;
      return normalizeExecutableName(app.appName) === normalizeExecutableName(value)
        || domainMatches(app.domain, value)
        || (app.title || '').toLowerCase().includes(value);
    });
    const local = apps.map(app => assessApp(categories, rules, {
      execPath: app.execPath || '', appName: app.appName, title: app.title || '', domain: app.domain, isIdle: false,
    }));
    const unknown = apps.map((app, index) => ({ app, index }))
      .filter(({ app, index }) => !!app?.appName && !local[index].known && !allowedMatch(app))
      .slice(0, 6);
    const llm = new Map<number, { verdict: AppVerdict; reason: string; confidence: number; source: DecisionSource; sources: EvidenceSource[] }>();
    const uncached = unknown.filter(({ app, index }) => {
      const key = appFingerprint({ execPath: app.execPath || '', appName: app.appName, domain: app.domain });
      const cached = reviewCache.get(key);
      if (!cached) return true;
      if (cached.expiresAt <= Date.now()) { reviewCache.delete(key); return true; }
      const { expiresAt: _expiresAt, ...value } = cached;
      llm.set(index, value);
      return false;
    });
    const searchByIndex = new Map<number, EvidenceSource[]>();
    const searchParts: string[] = [];

    // Independent free search is deliberately performed before the model call.
    // It remains useful when Google grounding is unavailable for the account.
    const searched = await Promise.all(uncached.map(async ({ app, index }) => {
      const query = app.domain ? `what is ${app.domain} website` : `what is ${app.appName} app software`;
      const hits = await searchWeb(query, 3).catch(() => []);
      return { app, index, query, hits };
    }));
    for (const { app, index, query, hits } of searched) {
      const sources = hits.map(h => ({ title: h.title, url: h.url, snippet: h.snippet }));
      searchByIndex.set(index, sources);
      if (sources.length) searchParts.push(`[${index}] ${app.appName} | title: ${app.title} | hostname: ${app.domain || 'unknown'}\n${formatSearchResults(query, hits)}`);
    }
    let searchContext = searchParts.join('\n\n');
    if (searchContext.length > 48_000) searchContext = `${searchContext.slice(0, 47_500)}\n[search context truncated]`;

    if (uncached.length && aiSettings?.apiKey?.trim()) {
      const baseUrl = normalizeBaseUrl(aiSettings.baseUrl);
      const model = aiSettings.model || 'gemma-4-31b-it';
      const list = unknown.map(({ app, index }) => `[${index}] app=${app.appName}; title=${app.title}; hostname=${app.domain || 'unknown'}`).join('\n');
      const prompt = lang === 'fa'
        ? `ناظر تمرکز مطالعه برای درس «${subject}» هستی. فقط موارد ناشناخته زیر را بررسی کن:\n${list}\n${searchContext ? `نتایج جست‌وجوی مستقل:\n${searchContext}` : 'نتیجه جست‌وجو موجود نیست.'}\nاگر شواهد کافی یا هماهنگ نیست، needs_review بده و حدس نزن. فقط JSON خام بده: [{"index":0,"verdict":"productive|neutral|distracting|needs_review","confidence":0.0,"reason":"توضیح کوتاه فارسی","sources":[{"title":"...","url":"https://..."}]}]`
        : `You are a study-focus supervisor for "${subject}". Evaluate only these unknown items:\n${list}\n${searchContext ? `Independent search results:\n${searchContext}` : 'No search result.'}\nIf evidence is missing or contradictory, return needs_review; never guess. Return ONLY JSON: [{"index":0,"verdict":"productive|neutral|distracting|needs_review","confidence":0.0,"reason":"short explanation","sources":[{"title":"...","url":"https://..."}]}]`;
      let grounded = false;
      try {
        const parsed = await chatCompletion(baseUrl, model, aiSettings.apiKey, [
          { role: 'system', content: 'Return strict JSON only. Never invent sources.' },
          { role: 'user', content: prompt },
        ], LLM_TIMEOUT_MS, 0.15, !!aiSettings.searchEnabled, tool => { if (tool === 'google_search') grounded = true; });
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const index = Number(item?.index);
            if (!Number.isInteger(index) || !uncached.some(x => x.index === index)) continue;
            const confidence = Math.max(0, Math.min(1, Number(item?.confidence) || 0));
            const rawVerdict = item?.verdict;
            const verdict: AppVerdict = rawVerdict === 'productive' || rawVerdict === 'neutral' || rawVerdict === 'distracting'
              ? (confidence >= 0.65 ? rawVerdict : 'needs_review')
              : 'needs_review';
            const modelSources: EvidenceSource[] = Array.isArray(item?.sources)
              ? item.sources.filter((s: any) => typeof s?.url === 'string' && /^https?:\/\//i.test(s.url)).slice(0, 3).map((s: any) => ({ title: String(s.title || s.url), url: s.url }))
              : [];
            const result = {
              verdict,
              confidence,
              reason: String(item?.reason || ''),
              source: grounded ? 'google_grounding' : (searchByIndex.get(index)?.length ? 'web_search' : 'fallback'),
              sources: modelSources.length ? modelSources : (searchByIndex.get(index) || []),
            } as { verdict: AppVerdict; reason: string; confidence: number; source: DecisionSource; sources: EvidenceSource[] };
            llm.set(index, result);
            const app = apps[index];
            if (app) reviewCache.set(appFingerprint({ execPath: app.execPath || '', appName: app.appName, domain: app.domain }), { ...result, expiresAt: Date.now() + REVIEW_CACHE_TTL_MS });
          }
        }
      } catch (err) {
        // Search results remain available as evidence; an AI/provider failure
        // must degrade to needs_review instead of aborting the audit.
        console.warn('[AIEvaluator] Reliable audit model step failed:', err);
      }
    }

    const out: EnvironmentAuditItem[] = [];
    for (let i = 0; i < apps.length; i++) {
      const app = apps[i];
      if (!app?.appName || /electron|focusstudy/i.test(app.appName)) continue;
      const localResult = local[i];
      const fingerprint = appFingerprint({ execPath: app.execPath || '', appName: app.appName, domain: app.domain });
      let verdict: AppVerdict;
      let reason = '';
      let confidence = localResult.confidence;
      let source: DecisionSource = localResult.source;
      let sources: EvidenceSource[] = [];
      if (allowedMatch(app)) {
        verdict = 'productive'; confidence = 1; source = 'allowed_app';
        reason = lang === 'fa' ? 'این مورد توسط کاربر برای این پارت مجاز شده است.' : 'Allowed by the user for this block.';
      } else if (localResult.known) {
        verdict = localResult.category.type === 'idle' ? 'neutral' : localResult.category.type as AppVerdict;
        if (source === 'system') reason = lang === 'fa' ? 'جزء برنامه‌های سیستمی بی‌ضرر است.' : 'Recognized as a harmless system component.';
      } else if (llm.has(i)) {
        const result = llm.get(i)!;
        verdict = result.verdict; reason = result.reason; confidence = result.confidence; source = result.source; sources = result.sources;
      } else {
        verdict = 'needs_review';
        reason = lang === 'fa' ? 'ماهیت این برنامه قطعی نیست؛ بررسی دستی لازم است.' : 'This app could not be identified confidently; review is required.';
      }
      out.push({ appName: app.appName, title: app.title || app.appName, execPath: app.execPath, domain: app.domain, verdict, reason, confidence, source, fingerprint, sources });
    }
    const order: Record<AppVerdict, number> = { needs_review: 0, distracting: 1, neutral: 2, productive: 3 };
    return out.sort((a, b) => order[a.verdict] - order[b.verdict]);
  }

  /**
   * Analyzes the running environment applications individually using AI or
   * intelligent rule fallback. Returns a VERDICT for every scanned app
   * (verdict: 'distracting' | 'neutral' | 'productive' for every app), so the
   * UI can render a three-state checklist. When web search is enabled the LLM
   * is instructed to search the web to identify unknown apps before judging.
   */
  public static async auditEnvironmentDetailed(
    apps: { appName: string; title: string; domain?: string }[],
    subject: string,
    allowedApps: string[],
    aiSettings?: AISettings,
    lang: 'en' | 'fa' = 'fa'
  ): Promise<EnvironmentAuditItem[]> {
    // Keep the historical public method as a compatibility alias. All callers
    // now use the guarded, evidence-aware pipeline above.
    return this.auditEnvironmentReliable(apps, subject, allowedApps, aiSettings, lang);
    /* Legacy implementation retained below only as migration reference.
    const lowerAllowed = (allowedApps || []).map(a => a.toLowerCase());

    // --- Step 1: collect LLM verdicts when an API key exists ---
    const llmVerdicts = new Map<number, { verdict: AppVerdict; reason: string }>();
    if (aiSettings && aiSettings.apiKey && aiSettings.apiKey.trim().length > 0) {
      const baseUrl = normalizeBaseUrl(aiSettings.baseUrl);
      const model = aiSettings.model || 'gemma-4-31b-it';

      // Decide which apps are "unknown" and must be web-searched before judging.
      // Known (productive/distracting/allowed/AI-assistant) apps are NOT searched.
      const isKnownApp = (app: { appName: string; title: string; domain?: string }): boolean => {
        const lowerApp = (app.appName || '').toLowerCase();
        const lowerTitle = (app.title || '').toLowerCase();
        const lowerDomain = (app.domain || '').toLowerCase();
        if (lowerApp.includes('electron') || lowerApp.includes('focusstudy')) return true;
        if (lowerAllowed.some(a => lowerApp.includes(a) || lowerTitle.includes(a) || lowerDomain.includes(a))) return true;
        if (isAIAssistant(app.appName, app.title, app.domain)) return true;
        if (PRODUCTIVE_EXECUTABLES.includes(lowerApp)) return true;
        if (DISTRACTING_EXECUTABLES.includes(lowerApp)) return true;
        if (DISTRACTING_DOMAINS.some(d => lowerDomain === d || lowerDomain.endsWith('.' + d) || lowerTitle.includes(d))) return true;
        return false;
      };

      const unknownApps = apps
        .map((a, i) => ({ app: a, index: i }))
        .filter(({ app }) => app && app.appName && !isKnownApp(app));

      const SEARCH_BATCH = 3;
      const MAX_SEARCHES = 8;
      const toSearch = unknownApps.slice(0, MAX_SEARCHES);
      const searchContextParts: string[] = [];

      for (let start = 0; start < toSearch.length; start += SEARCH_BATCH) {
        const batch = toSearch.slice(start, start + SEARCH_BATCH);
        const results = await Promise.all(batch.map(async ({ app, index }) => {
          const query = app.domain
            ? `what is ${app.domain} website`
            : `what is ${app.appName} app software`;
          const hits = await searchWeb(query, 3);
          return { index, app, hits };
        }));
        for (const r of results) {
          if (r.hits.length === 0) continue;
          searchContextParts.push(
            `[App ${r.index}: "${r.app.appName}" Title: "${r.app.title}"]\n${formatSearchResults(`what is ${r.app.domain || r.app.appName}`, r.hits)}`
          );
        }
      }
      const searchContext = searchContextParts.join('\n\n');

      const windowListStr = apps.map((a, i) => `[${i}] App: ${a.appName}, Title: "${a.title}", Domain: "${a.domain || ''}"`).join('\n');
      const allowedStr = (allowedApps || []).join(', ');

      const searchContextSectionFa = searchContext
        ? `\nاطلاعات مربوط به برنامه‌های ناشناخته که از جستجوی وب به‌دست آمده:\n${searchContext}\n`
        : '';
      const searchContextSectionEn = searchContext
        ? `\nWeb search information for unknown apps:\n${searchContext}\n`
        : '';

      const prompt = lang === 'fa'
        ? `شما یک ناظر حفظ تمرکز مطالعاتی هستید. دانش‌آموز می‌خواهد پارت درس "${subject}" را شروع کند. لیست پنجره‌های باز ویندوز او:
${windowListStr}
${searchContextSectionFa}
برای هر برنامه یکی از سه حالت زیر را تعیین کن:
- "productive": برنامه‌ای که برای درس "${subject}" مستقیم لازم است یا کاملاً بی‌خطر و مفید است (مثل ویرایشگر کد، PDF، دستیار هوش مصنوعی درسی).
- "neutral": برنامه‌ای که نه برای درس لازم است و نه واقعاً مزاحم؛ مثل VPN، ابزارهای سیستمی بی‌ضرر.
- "distracting": برنامه‌ای که حواس‌پرت‌کننده است (بازی، شبکه اجتماعی، پیام‌رسان، موزیک/فیلم، فروشگاه آنلاین، خبر، سرگرمی، یا برنامه ناشناخته‌ای که ماهیتش مشخص نیست).

قوانین سخت‌گیرانه:
1) بازی‌ها، شبکه‌های اجتماعی، پیام‌رسان‌ها، پخش‌کننده‌های موسیقی/فیلم، فروشگاه‌های آنلاین، سایت‌های خبری و سرگرمی را قطعاً distracting کن.
2) اگر بین دو حالت مردد بودی یا ماهیت برنامه‌ای مشخص نبود، حالت سخت‌گیرانه‌تر را بگیر (distracting نیاز به بررسی).
3) برنامه‌های مجاز این پارت (که کاربر خودش اضافه کرده): ${allowedStr || 'هیچ‌کدام'}. این‌ها حتماً productive هستند و نباید گزارش شوند.
4) دستیاران هوش مصنوعی (ChatGPT، Gemini، Claude و…) ابزار مطالعه‌اند؛ productive.
5) هیچ پنجره‌ای را رها نکن؛ برای هر برنامه دقیقاً یک مورد در آرایه برگردان.
6) از اطلاعات جستجوی وب بالا برای ارزیابی برنامه‌های ناشناخته استفاده کن.

فقط و فقط JSON خام برگردان (بدون هیچ متن اضافه):
[{"index": number, "verdict": "productive"|"neutral"|"distracting", "reason": "توضیح کوتاه فارسی"}]
`
        : `You are a study-focus supervisor. The student wants to start a "${subject}" study block. Here are their currently open windows:
${windowListStr}
${searchContextSectionEn}
Assign ONE of three verdicts to every app:
- "productive": directly needed for studying "${subject}" or completely harmless/useful (e.g. code editor, PDF viewer, study AI assistant).
- "neutral": neither needed for the lesson nor actually harmful — e.g. a VPN, harmless system tools.
- "distracting": attention-stealers (games, social media, messengers, music/video, online shops, news, entertainment, or unknown apps of unclear nature).

Strict rules:
1) Always mark games, social media, messengers, music/video players, online shops, and entertainment/news sites as distracting.
2) When in doubt or if an app's nature remains unclear, pick the stricter verdict (distracting / needs review).
3) Allowed apps for this block (added by the user): ${allowedStr || 'none'}. They are always productive and must NOT be reported.
4) AI assistants (ChatGPT, Gemini, Claude, ...) are study tools — productive.
5) Do not skip any window; return exactly one item per app.
6) Use the web search information above to evaluate unknown apps.

Return ONLY raw JSON, no other text:
[{"index": number, "verdict": "productive"|"neutral"|"distracting", "reason": "short explanation"}]`;

      const parsedArray = await chatCompletion(baseUrl, model, aiSettings.apiKey, [
        { role: 'system', content: 'You are a strict JSON-only assistant. Never output markdown or prose.' },
        { role: 'user', content: prompt },
      ], LLM_TIMEOUT_MS, 0.2, false);

      if (Array.isArray(parsedArray)) {
        for (const item of parsedArray) {
          const idx = Number(item?.index);
          if (!apps[idx] || !item) continue;

          // Accept both the new "verdict" field and legacy isDistracting.
          let verdict: AppVerdict = 'neutral';
          if (item.verdict === 'productive' || item.verdict === 'distracting') {
            verdict = item.verdict;
          } else if (item.isDistracting === true) {
            verdict = 'distracting';
          }

          // Safety net: never flag an explicitly allowed app, even if the LLM slips.
          const app = apps[idx];
          const lowerApp = app.appName.toLowerCase();
          const lowerTitle = app.title.toLowerCase();
          const lowerDomain = (app.domain || '').toLowerCase();
          const isExplicitlyAllowed = lowerAllowed.some(allowed =>
            lowerApp.includes(allowed) || lowerTitle.includes(allowed) || lowerDomain.includes(allowed)
          );
          if (isExplicitlyAllowed) verdict = 'productive';

          llmVerdicts.set(idx, { verdict, reason: String(item.reason || '') });
        }
      } else {
        console.warn('[AIEvaluator] LLM audit response was not a valid array; falling back to heuristics.');
      }
    }

    // --- Step 2: build the per-app three-state checklist ---
    const auditItems: EnvironmentAuditItem[] = [];

    for (let i = 0; i < apps.length; i++) {
      const app = apps[i];
      if (!app || !app.appName) continue;

      const lowerApp = (app.appName || '').toLowerCase();
      const lowerTitle = (app.title || '').toLowerCase();
      const lowerDomain = (app.domain || '').toLowerCase();

      // Never flag the app itself.
      if (lowerApp.includes('electron') || lowerApp.includes('focusstudy')) continue;

      const isExplicitlyAllowed = lowerAllowed.some(allowed =>
        lowerApp.includes(allowed) || lowerTitle.includes(allowed) || lowerDomain.includes(allowed)
      );

      // LLM verdict (with search-based identification) is authoritative.
      const llm = llmVerdicts.get(i);
      if (llm) {
        auditItems.push({
          appName: app.appName,
          title: app.title || app.appName,
          domain: app.domain,
          verdict: llm.verdict,
          reason: llm.reason,
        });
        continue;
      }

      // Otherwise fall back to the strict local heuristic (also used when no
      // API key is configured). Allowed apps and study tools are productive.
      let verdict: AppVerdict = 'productive';
      let reason = '';

      if (isExplicitlyAllowed || isAIAssistant(app.appName, app.title, app.domain)) {
        verdict = 'productive';
      } else if (DISTRACTING_DOMAINS.some(d => lowerDomain.includes(d) || lowerTitle.includes(d))) {
        verdict = 'distracting';
        reason = lang === 'fa'
          ? `پنجره/تب "${app.title}" محتوای غیرمرتبط یا رسانه‌ای دارد.`
          : `Window/tab "${app.title}" contains distracting media content.`;
      } else if (DISTRACTING_EXECUTABLES.some(exe => lowerApp.includes(exe))) {
        verdict = 'distracting';
        reason = lang === 'fa'
          ? `برنامه ${app.appName} در دسته بازی/پیام‌رسان/رسانه قرار دارد.`
          : `Application ${app.appName} is a game/chat/media app.`;
      } else if (DISTRACTING_KEYWORDS.some(kw => lowerTitle.includes(kw) || lowerDomain.includes(kw))) {
        verdict = 'distracting';
        reason = lang === 'fa'
          ? `عنوان پنجره "${app.title}" نشانی از محتوای سرگرمی/حواس‌پرت‌کننده دارد.`
          : `Window title "${app.title}" indicates distracting/entertainment content.`;
      } else if (PRODUCTIVE_EXECUTABLES.some(exe => lowerApp.includes(exe))) {
        verdict = 'productive';
      } else {
        // Unknown app — conservative: flag for review rather than silently clearing it.
        verdict = 'distracting';
        reason = lang === 'fa'
          ? `این برنامه برای سیستم ناشناخته است و ماهیتش مشخص نیست. برای شروع پارت، آن را ببندید یا با AI توجیه کنید.`
          : `This app is unknown to the local system. Close it or justify with AI before starting.`;
      }

      auditItems.push({
        appName: app.appName,
        title: app.title || app.appName,
        domain: app.domain,
        verdict,
        reason,
      });
    }

    // Distracting first (must resolve), then neutral (optional), then approved.
    const order: Record<AppVerdict, number> = { needs_review: 0, distracting: 1, neutral: 2, productive: 3 };
    return auditItems.sort((a, b) => order[a.verdict] - order[b.verdict]);
  }
    */
  }

  /**
   * Evaluates a user justification for accessing an unallowed application using
   * the LLM API or the smart fallback engine.
   */
  public static async evaluateJustification(
    request: AIJustificationRequest,
    aiSettings?: AISettings,
    lang: 'en' | 'fa' = 'fa'
  ): Promise<AIJustificationResult> {
    if (aiSettings && aiSettings.apiKey && aiSettings.apiKey.trim().length > 0) {
      const baseUrl = normalizeBaseUrl(aiSettings.baseUrl);
      const model = aiSettings.model || 'gemma-4-31b-it';

      const prompt = lang === 'fa'
        ? `شما یک دستیار هوشمند و دلسوز هوش مصنوعی برای حفظ تمرکز در مطالعه هستید. دانش‌آموز در حال مطالعه درس "${request.subject}" برای پارت "${request.blockTitle}" است و درخواست دسترسی اضطراری به برنامه "${request.appName}" را دارد. دلیل ارائه شده: "${request.reason}".
آیا این دلیل منطقی، صادقانه و مرتبط با فرایند مطالعه است؟

راهنمایی:
- استفاده از دستیاران هوش مصنوعی (ChatGPT، Gemini، Claude و…) برای پرسیدن سوال درسی، حل تمرین یا جستجوی موضوع مرتبط با درس کاملاً منطقی و مجاز است.
- دلایلی مثل «سوال دارم»، «این مبحث را نمی‌فهمم»، «باید سرچ کنم / چیزی را پیدا کنم» معتبر هستند.
- فقط دلایل غیرصادقانه یا سرگرمی/تفریحی که به درس ربطی ندارند را رد کن.
پاسخ خود را فقط و فقط به صورت JSON خام برگردانید:
{"approved": boolean, "aiResponse": "توضیح کوتاه و صمیمی به زبان فارسی"}`
        : `You are a AI study focus assistant. A student studying "${request.subject}" (${request.blockTitle}) wants temporary emergency access to "${request.appName}" with reason: "${request.reason}".
Is this reason legitimate and relevant for studying?

Guidelines:
- Using AI assistants (ChatGPT, Gemini, Claude, ...) to ask study questions, solve exercises, or search for a topic related to the subject IS legitimate.
- Reasons like "I have a question", "I don't understand this topic", "I need to look something up / search for it" are valid.
- Only deny clearly dishonest or fun/entertainment reasons unrelated to studying.

Return ONLY raw JSON: {"approved": boolean, "aiResponse": "short response in English"}`;

      const parsed = await chatCompletion(baseUrl, model, aiSettings.apiKey, [
        { role: 'system', content: 'You are a strict JSON-only assistant. Never output markdown or prose.' },
        { role: 'user', content: prompt },
      ], LLM_TIMEOUT_MS, 0.3, !!aiSettings.searchEnabled);

      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.approved === 'boolean') {
          return {
            approved: obj.approved,
            aiResponse: String(obj.aiResponse || ''),
            grantedDurationMinutes: obj.approved ? 15 : 0,
          };
        }
      }
      console.warn('[AIEvaluator] LLM justification response invalid; falling back to heuristics.');
    }

    // Heuristic Fallback Engine
    const reason = (request.reason || '').toLowerCase();
    const appName = (request.appName || '').toLowerCase();
    const subject = (request.subject || '').toLowerCase();

    const studyKeywords = [
      'ریاضی', 'ماشین حساب', 'فرمول', 'تحقیق', 'ترجمه', 'دیکشنری', 'جزوه', 'کد', 'برنامه‌نویسی', 'کتاب', 'تمرین', 'پروژه',
      'سوال', 'سؤال', 'جواب', 'نفهمیدم', 'اشکال', 'توضیح', 'کمک', 'حل', 'درس', 'سرچ', 'جستجو', 'مطلب',
      'math', 'calculator', 'formula', 'research', 'translate', 'dictionary', 'code', 'book', 'exercise', 'doc', 'documentation',
      'ask', 'question', 'help', 'explain', 'solve', 'stuck', 'doubt', 'search', 'topic', 'lookup',
    ];

    const distractionKeywords = [
      'چت', 'بازی', 'اینستاگرام', 'یوتیوب', 'کلیپ', 'موزیک ویدیو', 'فیلم', 'توییت',
      'chat', 'game', 'instagram', 'youtube', 'short', 'reel', 'movie', 'tweet',
    ];

    const hasStudyKeyword = studyKeywords.some(k => reason.includes(k) || subject.includes(k));
    const hasDistractionKeyword = distractionKeywords.some(k => reason.includes(k));
    const isAssistant = isAIAssistant(request.appName, request.title);

    const studyNeed = reason.length > 5 && (hasStudyKeyword || appName.includes('calc') || appName.includes('browser'));
    const assistantStudyUse = isAssistant && reason.length > 5 && (hasStudyKeyword || !hasDistractionKeyword);

    if ((studyNeed || assistantStudyUse) && !hasDistractionKeyword) {
      return {
        approved: true,
        aiResponse: lang === 'fa'
          ? `درخواست شما بررسی شد: استفاده از "${request.appName}" برای پارت مطالعه "${request.subject}" منطقی و تایید شد. دسترسی موقت به مدت ۱۵ دقیقه فعال گردید.`
          : `Justification approved: Accessing "${request.appName}" for "${request.subject}" is legitimate. Temporary 15-minute pass granted.`,
        grantedDurationMinutes: 15,
      };
    }

    return {
      approved: false,
      aiResponse: lang === 'fa'
        ? `هوش مصنوعی درخواست شما را رد کرد: دلیل ارائه شده ("${request.reason}") برای پارت مطالعاتی ${request.subject} کافی و مرتبط تشخیص داده نشد. لطفاً روی تمرین خود تمرکز کنید!`
        : `Justification denied: The reason provided ("${request.reason}") is not sufficiently relevant to ${request.subject}. Stay focused!`,
    };
  }
}
