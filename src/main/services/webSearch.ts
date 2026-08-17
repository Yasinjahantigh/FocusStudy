import { URL } from 'url';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SEARCH_TIMEOUT_MS = 8_000;
const MAX_RESULTS = 5;

function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

/**
 * Executes a web search through DuckDuckGo's HTML endpoint (no API key
 * required) and returns the top ranked results. Used as the client-side
 * executor for the `search_web` tool declared to the LLM.
 * Returns [] on any failure so callers can degrade gracefully.
 */
export async function searchWeb(query: string, maxResults = MAX_RESULTS): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  try {
    const boundedQuery = String(query || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 240);
    if (!boundedQuery) return results;
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', boundedQuery);
    url.searchParams.set('kl', 'wt-wt');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    let html: string;
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FocusStudy/1.0',
          'Accept-Language': 'en-US,en;q=0.8',
        },
        signal: controller.signal,
      });
      if (!response.ok) return results;
      html = await response.text();
    } finally {
      clearTimeout(timer);
    }

    // DuckDuckGo HTML layout: each result is a <div class="result"> block
    // containing <a class="result__a" href="...">Title</a> and a
    // <a class="result__snippet">Snippet</a>.
    const resultBlocks = html.split('result__a"');
    for (const block of resultBlocks.slice(1)) {
      if (results.length >= maxResults) break;

      const titleMatch = />(.*?)<\/a>/.exec(block);
      const urlMatch = /href="([^"]+)"/.exec(block);
      if (!titleMatch || !urlMatch) continue;

      let rawUrl = urlMatch[1];
      const ddgRedirect = /uddg=([^&]+)/.exec(rawUrl);
      if (ddgRedirect) {
        try {
          rawUrl = decodeURIComponent(ddgRedirect[1]);
        } catch {
          // keep raw URL
        }
      }

      const snippetMatch = /result__snippet[^>]*>(.*?)<\/a>/.exec(block);
      const title = decodeEntities(titleMatch[1]).replace(/<[^>]+>/g, '').trim();
      const snippet = snippetMatch
        ? decodeEntities(snippetMatch[1]).replace(/<[^>]+>/g, '').trim()
        : '';

      if (title && /^https?:\/\//i.test(rawUrl)) {
        results.push({ title: title.slice(0, 240), url: rawUrl.slice(0, 1000), snippet: snippet.slice(0, 500) });
      }
    }
  } catch (err) {
    console.warn('[WebSearch] Search failed:', err);
  }

  return results;
}
