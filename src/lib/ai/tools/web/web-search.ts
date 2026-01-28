import { tool as createTool } from "ai";
import { JSONSchema7 } from "json-schema";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { safe } from "ts-safe";

// Web Search Types (local DuckDuckGo-based, no API key needed)
export interface WebSearchResult {
  id: string;
  title: string;
  url: string;
  publishedDate: string;
  author: string;
  text: string;
  image?: string;
  favicon?: string;
  score?: number;
}

export interface WebSearchResponse {
  requestId: string;
  autopromptString: string;
  resolvedSearchType: string;
  results: WebSearchResult[];
}

// Keep backward-compatible aliases
export type ExaSearchResult = WebSearchResult;
export type ExaSearchResponse = WebSearchResponse;

export interface WebSearchRequest {
  query: string;
  type: string;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  numResults: number;
  contents: {
    text?:
      | {
          maxCharacters?: number;
        }
      | boolean;
    highlights?: boolean;
    summary?: boolean;
    livecrawl?: "always" | "fallback" | "preferred" | "never";
    livecrawlTimeout?: number;
    subpages?: number;
    subpageTarget?: string[];
  };
}

export type ExaSearchRequest = WebSearchRequest;

export interface WebContentsRequest {
  ids: string[];
  contents: {
    text?:
      | {
          maxCharacters?: number;
        }
      | boolean;
    highlights?: boolean;
    summary?: boolean;
    livecrawl?: "always" | "fallback" | "preferred" | "never";
    livecrawlTimeout?: number;
  };
}

export type ExaContentsRequest = WebContentsRequest;

export const exaSearchSchema: JSONSchema7 = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query",
    },
    numResults: {
      type: "number",
      description: "Number of search results to return",
      default: 5,
      minimum: 1,
      maximum: 20,
    },
    type: {
      type: "string",
      enum: ["auto", "keyword", "neural", "fast"],
      description:
        "Search type - auto lets the engine decide, keyword for exact matches, neural for semantic search, fast for lower latency",
      default: "auto",
    },
    category: {
      type: "string",
      enum: [
        "company",
        "research paper",
        "news",
        "linkedin profile",
        "github",
        "tweet",
        "movie",
        "song",
        "personal site",
        "pdf",
      ],
      description: "Category to focus the search on",
    },
    includeDomains: {
      type: "array",
      items: { type: "string" },
      description: "List of domains to specifically include in search results",
      default: [],
    },
    excludeDomains: {
      type: "array",
      items: { type: "string" },
      description:
        "List of domains to specifically exclude from search results",
      default: [],
    },
    startPublishedDate: {
      type: "string",
      description: "Start date for published content (YYYY-MM-DD format)",
    },
    endPublishedDate: {
      type: "string",
      description: "End date for published content (YYYY-MM-DD format)",
    },
  },
  required: ["query"],
};

export const exaContentsSchema: JSONSchema7 = {
  type: "object",
  properties: {
    urls: {
      type: "array",
      items: { type: "string" },
      description: "List of URLs to extract content from",
    },
    maxCharacters: {
      type: "number",
      description: "Maximum characters to extract from each URL",
      default: 1500,
      minimum: 100,
      maximum: 10000,
    },
  },
  required: ["urls"],
};

// ============================================================
// Local DuckDuckGo search implementation (no API key needed)
// ============================================================

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function getFavicon(url: string): string | undefined {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return undefined;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchDuckDuckGo(
  query: string,
  numResults: number = 5,
): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];

  // Primary: DuckDuckGo HTML search
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(searchUrl, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  const html = await response.text();

  const resultRegex =
    /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while (
    (match = resultRegex.exec(html)) !== null &&
    results.length < numResults
  ) {
    const url = match[1];
    const title = match[2].trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();

    // Skip DuckDuckGo internal links
    if (!url.startsWith("//duckduckgo.com")) {
      results.push({
        id: url,
        title,
        url,
        text: snippet,
        publishedDate: "",
        author: "",
        favicon: getFavicon(url),
      });
    }
  }

  // Warn if HTML was non-empty but regex matched nothing — DDG may have changed markup
  if (results.length === 0 && html.length > 500) {
    console.warn(
      `[web-search] DuckDuckGo HTML response (${html.length} chars) yielded 0 regex matches — markup may have changed`,
    );
  }

  // Fallback: DuckDuckGo instant answer API
  if (results.length === 0) {
    const instantUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const instantResponse = await fetch(instantUrl);
    const instantData = await instantResponse.json();

    if (instantData.AbstractText) {
      const abstractUrl = instantData.AbstractURL || "";
      results.push({
        id: abstractUrl || "instant-answer",
        title: instantData.Heading || "DuckDuckGo Answer",
        url: abstractUrl,
        text: instantData.AbstractText,
        publishedDate: "",
        author: instantData.AbstractSource || "",
        favicon: abstractUrl ? getFavicon(abstractUrl) : undefined,
      });
    }

    if (instantData.RelatedTopics) {
      for (const topic of instantData.RelatedTopics.slice(
        0,
        numResults - results.length,
      )) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            id: topic.FirstURL,
            title: topic.Text.split(" - ")[0] || "Related",
            url: topic.FirstURL,
            text: topic.Text,
            publishedDate: "",
            author: "",
            favicon: getFavicon(topic.FirstURL),
          });
        }
      }
    }
  }

  return results;
}

async function fetchUrlContent(
  url: string,
  maxCharacters: number = 1500,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  let text = stripHtml(html);

  if (text.length > maxCharacters) {
    text = text.slice(0, maxCharacters) + "... [truncated]";
  }

  return text;
}

// ============================================================
// Tool exports (same names as before for backward compatibility)
// ============================================================

export const exaSearchToolForWorkflow = createTool({
  description:
    "Search the web for information - performs real-time web searches using DuckDuckGo. Returns relevant results with titles, URLs, and content snippets. No API key needed.",
  inputSchema: jsonSchemaToZod(exaSearchSchema),
  execute: async (params) => {
    const numResults = params.numResults || 5;
    const results = await searchDuckDuckGo(params.query, numResults);

    return {
      requestId: crypto.randomUUID(),
      autopromptString: params.query,
      resolvedSearchType: "duckduckgo",
      results,
    } as WebSearchResponse;
  },
});

export const exaContentsToolForWorkflow = createTool({
  description:
    "Extract detailed content from specific URLs - retrieves full text content from web pages. No API key needed.",
  inputSchema: jsonSchemaToZod(exaContentsSchema),
  execute: async (params) => {
    const maxChars = params.maxCharacters || 1500;
    const urls: string[] = params.urls;

    const results: WebSearchResult[] = await Promise.all(
      urls.map(async (url: string) => {
        try {
          const text = await fetchUrlContent(url, maxChars);
          return {
            id: url,
            title: url,
            url,
            text,
            publishedDate: "",
            author: "",
            favicon: getFavicon(url),
          };
        } catch (e: any) {
          return {
            id: url,
            title: url,
            url,
            text: `Error fetching content: ${e.message}`,
            publishedDate: "",
            author: "",
            favicon: getFavicon(url),
          };
        }
      }),
    );

    return {
      requestId: crypto.randomUUID(),
      autopromptString: "",
      resolvedSearchType: "fetch",
      results,
    } as WebSearchResponse;
  },
});

export const exaSearchTool = createTool({
  description:
    "Search the web for information - performs real-time web searches using DuckDuckGo. Returns relevant results with titles, URLs, and content snippets. No API key needed.",
  inputSchema: jsonSchemaToZod(exaSearchSchema),
  execute: (params) => {
    return safe(async () => {
      const numResults = params.numResults || 5;
      const results = await searchDuckDuckGo(params.query, numResults);

      return {
        requestId: crypto.randomUUID(),
        autopromptString: params.query,
        resolvedSearchType: "duckduckgo",
        results,
        guide: `Use the search results to answer the user's question. Summarize the content and ask if they have any additional questions about the topic.`,
      };
    })
      .ifFail((e) => {
        return {
          isError: true,
          error: e.message,
          solution:
            "A web search error occurred. First, explain to the user what caused this specific error and how they can resolve it. Then provide helpful information based on your existing knowledge to answer their question.",
        };
      })
      .unwrap();
  },
});

export const exaContentsTool = createTool({
  description:
    "Extract detailed content from specific URLs - retrieves full text content from web pages. No API key needed.",
  inputSchema: jsonSchemaToZod(exaContentsSchema),
  execute: async (params) => {
    return safe(async () => {
      const maxChars = params.maxCharacters || 1500;
      const urls: string[] = params.urls;

      const results: WebSearchResult[] = await Promise.all(
        urls.map(async (url: string) => {
          try {
            const text = await fetchUrlContent(url, maxChars);
            return {
              id: url,
              title: url,
              url,
              text,
              publishedDate: "",
              author: "",
              favicon: getFavicon(url),
            };
          } catch (e: any) {
            return {
              id: url,
              title: url,
              url,
              text: `Error fetching content: ${e.message}`,
              publishedDate: "",
              author: "",
              favicon: getFavicon(url),
            };
          }
        }),
      );

      return {
        requestId: crypto.randomUUID(),
        autopromptString: "",
        resolvedSearchType: "fetch",
        results,
      } as WebSearchResponse;
    })
      .ifFail((e) => {
        return {
          isError: true,
          error: e.message,
          solution:
            "A web content extraction error occurred. First, explain to the user what caused this specific error and how they can resolve it. Then provide helpful information based on your existing knowledge to answer their question.",
        };
      })
      .unwrap();
  },
});
