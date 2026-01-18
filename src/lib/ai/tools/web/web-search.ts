import { tool as createTool } from "ai";
import { JSONSchema7 } from "json-schema";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { safe } from "ts-safe";

// Exa API Types
export interface ExaSearchRequest {
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

export interface ExaSearchResult {
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

export interface ExaSearchResponse {
  requestId: string;
  autopromptString: string;
  resolvedSearchType: string;
  results: ExaSearchResult[];
}

export interface ExaContentsRequest {
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
        "Search type - auto lets Exa decide, keyword for exact matches, neural for semantic search, fast for 30% faster responses with lower latency",
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
    maxCharacters: {
      type: "number",
      description: "Maximum characters to extract from each result",
      default: 1500,
      minimum: 100,
      maximum: 10000,
    },
    livecrawl: {
      type: "string",
      enum: ["always", "fallback", "preferred", "never"],
      description:
        "Live crawling preference - always forces live crawl (guaranteed fresh), preferred tries live first then cache, fallback uses cache first, never uses cache only",
      default: "always",
    },
    livecrawlTimeout: {
      type: "number",
      description:
        "Maximum time in milliseconds to wait for live crawl (100-10000ms)",
      default: 10000,
      minimum: 100,
      maximum: 10000,
    },
    contentMode: {
      type: "string",
      enum: ["text", "highlights", "summary"],
      description:
        "Content extraction mode - text returns full text, highlights returns key snippets, summary returns AI-generated summaries",
      default: "text",
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
    livecrawl: {
      type: "string",
      enum: ["always", "fallback", "preferred", "never"],
      description:
        "Live crawling preference - always forces live crawl (guaranteed fresh), preferred tries live first then cache, fallback uses cache first, never uses cache only",
      default: "always",
    },
    livecrawlTimeout: {
      type: "number",
      description:
        "Maximum time in milliseconds to wait for live crawl (100-10000ms)",
      default: 10000,
      minimum: 100,
      maximum: 10000,
    },
    contentMode: {
      type: "string",
      enum: ["text", "highlights", "summary"],
      description:
        "Content extraction mode - text returns full text, highlights returns key snippets, summary returns AI-generated summaries",
      default: "text",
    },
  },
  required: ["urls"],
};

const API_KEY = process.env.EXA_API_KEY;
const BASE_URL = "https://api.exa.ai";

const fetchExa = async (endpoint: string, body: any): Promise<any> => {
  if (!API_KEY) {
    throw new Error("EXA_API_KEY is not configured");
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    throw new Error("Invalid EXA API key");
  }
  if (response.status === 429) {
    throw new Error("Exa API usage limit exceeded");
  }

  if (!response.ok) {
    throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
};

export const exaSearchToolForWorkflow = createTool({
  description:
    "Search the web using Exa AI - performs real-time web searches with semantic and neural search capabilities. Returns high-quality, relevant results with full content extraction. Optimized for freshness and performance.",
  inputSchema: jsonSchemaToZod(exaSearchSchema),
  execute: async (params) => {
    const contentMode = params.contentMode || "text";
    const maxChars = params.maxCharacters || 1500;
    const livecrawl = params.livecrawl || "always";
    const livecrawlTimeout = params.livecrawlTimeout || 10000;

    const contents: ExaSearchRequest["contents"] = {
      livecrawl: livecrawl as "always" | "fallback" | "preferred" | "never",
      livecrawlTimeout,
    };

    // Set content extraction mode
    if (contentMode === "highlights") {
      contents.highlights = true;
    } else if (contentMode === "summary") {
      contents.summary = true;
    } else {
      contents.text = {
        maxCharacters: maxChars,
      };
    }

    const searchRequest: ExaSearchRequest = {
      query: params.query,
      type: params.type || "auto",
      numResults: params.numResults || 5,
      contents,
    };

    // Add optional parameters if provided
    if (params.category) searchRequest.category = params.category;
    if (params.includeDomains?.length)
      searchRequest.includeDomains = params.includeDomains;
    if (params.excludeDomains?.length)
      searchRequest.excludeDomains = params.excludeDomains;
    if (params.startPublishedDate)
      searchRequest.startPublishedDate = params.startPublishedDate;
    if (params.endPublishedDate)
      searchRequest.endPublishedDate = params.endPublishedDate;

    return fetchExa("/search", searchRequest);
  },
});

export const exaContentsToolForWorkflow = createTool({
  description:
    "Extract detailed content from specific URLs using Exa AI - retrieves full text content, metadata, and structured information from web pages with live crawling capabilities. Optimized for freshness and performance.",
  inputSchema: jsonSchemaToZod(exaContentsSchema),
  execute: async (params) => {
    const contentMode = params.contentMode || "text";
    const maxChars = params.maxCharacters || 1500;
    const livecrawl = params.livecrawl || "always";
    const livecrawlTimeout = params.livecrawlTimeout || 10000;

    const contents: ExaContentsRequest["contents"] = {
      livecrawl: livecrawl as "always" | "fallback" | "preferred" | "never",
      livecrawlTimeout,
    };

    // Set content extraction mode
    if (contentMode === "highlights") {
      contents.highlights = true;
    } else if (contentMode === "summary") {
      contents.summary = true;
    } else {
      contents.text = {
        maxCharacters: maxChars,
      };
    }

    const contentsRequest: ExaContentsRequest = {
      ids: params.urls,
      contents,
    };

    return fetchExa("/contents", contentsRequest);
  },
});

export const exaSearchTool = createTool({
  description:
    "Search the web using Exa AI - performs real-time web searches with semantic and neural search capabilities. Returns high-quality, relevant results with full content extraction. Optimized for freshness and performance.",
  inputSchema: jsonSchemaToZod(exaSearchSchema),
  execute: (params) => {
    return safe(async () => {
      const contentMode = params.contentMode || "text";
      const maxChars = params.maxCharacters || 1500;
      const livecrawl = params.livecrawl || "always";
      const livecrawlTimeout = params.livecrawlTimeout || 10000;

      const contents: ExaSearchRequest["contents"] = {
        livecrawl: livecrawl as "always" | "fallback" | "preferred" | "never",
        livecrawlTimeout,
      };

      // Set content extraction mode
      if (contentMode === "highlights") {
        contents.highlights = true;
      } else if (contentMode === "summary") {
        contents.summary = true;
      } else {
        contents.text = {
          maxCharacters: maxChars,
        };
      }

      const searchRequest: ExaSearchRequest = {
        query: params.query,
        type: params.type || "auto",
        numResults: params.numResults || 5,
        contents,
      };

      // Add optional parameters if provided
      if (params.category) searchRequest.category = params.category;
      if (params.includeDomains?.length)
        searchRequest.includeDomains = params.includeDomains;
      if (params.excludeDomains?.length)
        searchRequest.excludeDomains = params.excludeDomains;
      if (params.startPublishedDate)
        searchRequest.startPublishedDate = params.startPublishedDate;
      if (params.endPublishedDate)
        searchRequest.endPublishedDate = params.endPublishedDate;

      const result = await fetchExa("/search", searchRequest);

      return {
        ...result,
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
    "Extract detailed content from specific URLs using Exa AI - retrieves full text content, metadata, and structured information from web pages with live crawling capabilities. Optimized for freshness and performance.",
  inputSchema: jsonSchemaToZod(exaContentsSchema),
  execute: async (params) => {
    return safe(async () => {
      const contentMode = params.contentMode || "text";
      const maxChars = params.maxCharacters || 1500;
      const livecrawl = params.livecrawl || "always";
      const livecrawlTimeout = params.livecrawlTimeout || 10000;

      const contents: ExaContentsRequest["contents"] = {
        livecrawl: livecrawl as "always" | "fallback" | "preferred" | "never",
        livecrawlTimeout,
      };

      // Set content extraction mode
      if (contentMode === "highlights") {
        contents.highlights = true;
      } else if (contentMode === "summary") {
        contents.summary = true;
      } else {
        contents.text = {
          maxCharacters: maxChars,
        };
      }

      const contentsRequest: ExaContentsRequest = {
        ids: params.urls,
        contents,
      };

      return await fetchExa("/contents", contentsRequest);
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
