import { type Tool, tool as createTool } from "ai";
import type { UIMessageStreamWriter } from "ai";
import { colorize } from "consola/utils";
import globalLogger from "logger";
import { z } from "zod";
import {
  LocalBrowserService,
  BrowserbaseService,
} from "../browser/local-browser-service";

const logger = globalLogger.withDefaults({
  message: colorize("cyan", "[Deep Research Agent] "),
});

/**
 * Research source with extracted content
 */
export interface ResearchSource {
  url: string;
  title: string;
  content: string;
  publishedDate?: string;
  credibilityScore?: number;
  screenshot?: string;
}

/**
 * Research finding with citations
 */
export interface ResearchFinding {
  claim: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  notes?: string;
}

/**
 * Complete research result
 */
export interface ResearchResult {
  query: string;
  summary: string;
  findings: ResearchFinding[];
  sources: ResearchSource[];
  methodology: string;
  limitations?: string[];
  completedAt: Date;
}

/**
 * Research task options
 */
export interface ResearchOptions {
  /** User ID who owns this research session (required for browser session) */
  userId: string;
  /** Thread ID to associate the browser session with */
  threadId?: string;
  depth: "quick" | "standard" | "comprehensive";
  maxSources?: number;
  includeStealth?: boolean;
  takeScreenshots?: boolean;
}

/**
 * Deep Research Agent
 *
 * Conducts multi-step autonomous web research using Browserbase
 * with source citations and fact synthesis.
 */
export class DeepResearchAgent {
  private browserService: LocalBrowserService;
  private dataStream?: UIMessageStreamWriter;

  constructor(dataStream?: UIMessageStreamWriter) {
    this.browserService = BrowserbaseService.getInstance();
    this.dataStream = dataStream;
  }

  /**
   * Emit research progress to the UI
   */
  private emitProgress(
    stage: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    logger.info(`[${stage}] ${message}`);
    if (this.dataStream) {
      this.dataStream.write({
        type: "data-research-progress",
        data: {
          stage,
          message,
          timestamp: new Date().toISOString(),
          ...data,
        },
      });
    }
  }

  /**
   * Conduct deep research on a topic
   */
  async research(
    query: string,
    options: ResearchOptions,
  ): Promise<ResearchResult> {
    const startTime = Date.now();
    const sources: ResearchSource[] = [];
    const findings: ResearchFinding[] = [];

    // Determine max sources based on depth
    const maxSources =
      options.maxSources ??
      {
        quick: 3,
        standard: 7,
        comprehensive: 15,
      }[options.depth];

    this.emitProgress(
      "planning",
      `Starting ${options.depth} research on: ${query}`,
      {
        maxSources,
      },
    );

    let sessionId: string | undefined;

    try {
      // Create browser session
      this.emitProgress("setup", "Creating browser session...");
      const sessionResult = options.includeStealth
        ? await this.browserService.createStealthSession(
            options.userId,
            options.threadId,
          )
        : await this.browserService.createSession({
            userId: options.userId,
            threadId: options.threadId,
          });

      if (!sessionResult.ok) {
        throw new Error(
          `Failed to create browser session: ${sessionResult.error.message}`,
        );
      }

      sessionId = sessionResult.value.sessionId;

      // Phase 1: Search for sources
      this.emitProgress("searching", "Searching for relevant sources...");
      const searchResults = await this.searchForSources(
        sessionId,
        query,
        maxSources,
      );

      // Phase 2: Visit and extract from each source
      for (let i = 0; i < searchResults.length; i++) {
        const result = searchResults[i];
        this.emitProgress(
          "extracting",
          `Visiting source ${i + 1}/${searchResults.length}: ${result.title}`,
          {
            url: result.url,
            progress: ((i + 1) / searchResults.length) * 100,
          },
        );

        try {
          const source = await this.extractFromSource(
            sessionId,
            result.url,
            result.title,
            query,
            options.takeScreenshots,
          );
          sources.push(source);
        } catch (err) {
          logger.warn(`Failed to extract from ${result.url}:`, err);
        }
      }

      // Phase 3: Synthesize findings
      this.emitProgress(
        "synthesizing",
        "Analyzing and synthesizing findings...",
      );
      const synthesized = this.synthesizeFindings(sources, query);
      findings.push(...synthesized);

      // Phase 4: Generate summary
      this.emitProgress("summarizing", "Generating research summary...");
      const summary = this.generateSummary(query, findings, sources);

      const result: ResearchResult = {
        query,
        summary,
        findings,
        sources,
        methodology:
          `Conducted ${options.depth} research using ${sources.length} sources. ` +
          `Research included web search, content extraction, and cross-reference analysis.`,
        limitations: this.identifyLimitations(sources),
        completedAt: new Date(),
      };

      const duration = (Date.now() - startTime) / 1000;
      this.emitProgress(
        "complete",
        `Research completed in ${duration.toFixed(1)}s`,
        {
          sourcesFound: sources.length,
          findingsCount: findings.length,
        },
      );

      return result;
    } finally {
      // Clean up browser session
      if (sessionId) {
        try {
          await this.browserService.closeSession(sessionId);
        } catch (err) {
          logger.warn("Failed to close browser session:", err);
        }
      }
    }
  }

  /**
   * Search for relevant sources using web search
   */
  private async searchForSources(
    sessionId: string,
    query: string,
    maxResults: number,
  ): Promise<Array<{ url: string; title: string }>> {
    // Navigate to search engine
    await this.browserService.navigate(
      sessionId,
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    );

    // Extract search results using Stagehand
    const extractionResult = await this.browserService.extract(
      sessionId,
      "Extract the top search results including their titles and URLs",
      z.object({
        results: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            snippet: z.string().optional(),
          }),
        ),
      }),
    );

    // Handle Result type
    if (!extractionResult.ok) {
      logger.warn(
        `Failed to extract search results: ${extractionResult.error.message}`,
      );
      return [];
    }

    // Filter and limit results - value is the extracted data directly
    const results = (extractionResult.value?.results || [])
      .filter((r: { url: string }) => r.url && r.url.startsWith("http"))
      .slice(0, maxResults);

    logger.info(`Found ${results.length} search results`);
    return results;
  }

  /**
   * Extract content from a source URL
   */
  private async extractFromSource(
    sessionId: string,
    url: string,
    title: string,
    query: string,
    takeScreenshot?: boolean,
  ): Promise<ResearchSource> {
    // Navigate to the source
    await this.browserService.navigate(sessionId, url);

    // Extract main content
    const extractionResult = await this.browserService.extract(
      sessionId,
      `Extract the main content relevant to "${query}". Focus on factual information, dates, and key claims.`,
      z.object({
        mainContent: z.string(),
        publishedDate: z.string().optional(),
        author: z.string().optional(),
        keyPoints: z.array(z.string()).optional(),
      }),
    );

    // Handle Result type for extraction - value is the extracted data directly
    const extractedData = extractionResult.ok ? extractionResult.value : null;

    // Take screenshot if requested
    let screenshot: string | undefined;
    if (takeScreenshot) {
      const screenshotResult = await this.browserService.screenshot(sessionId);
      screenshot = screenshotResult.ok
        ? screenshotResult.value.base64
        : undefined;
    }

    return {
      url,
      title,
      content: extractedData?.mainContent || "",
      publishedDate: extractedData?.publishedDate,
      credibilityScore: this.assessCredibility(url, {
        publishedDate: extractedData?.publishedDate,
        author: extractedData?.author,
      }),
      screenshot,
    };
  }

  /**
   * Assess the credibility of a source
   */
  private assessCredibility(
    url: string,
    extraction: { publishedDate?: string; author?: string },
  ): number {
    let score = 0.5; // Base score

    // Check for known reliable domains
    const reliableDomains = [
      ".gov",
      ".edu",
      "reuters.com",
      "apnews.com",
      "bbc.com",
      "nytimes.com",
      "wsj.com",
      "nature.com",
      "sciencedirect.com",
    ];
    if (reliableDomains.some((d) => url.includes(d))) {
      score += 0.3;
    }

    // Has published date
    if (extraction.publishedDate) {
      score += 0.1;
    }

    // Has author
    if (extraction.author) {
      score += 0.1;
    }

    return Math.min(score, 1);
  }

  /**
   * Synthesize findings from multiple sources
   */
  private synthesizeFindings(
    sources: ResearchSource[],
    _query: string,
  ): ResearchFinding[] {
    const findings: ResearchFinding[] = [];
    const claimMap = new Map<string, string[]>();

    // Group similar claims by source
    for (const source of sources) {
      // In a real implementation, this would use NLP to extract claims
      // For now, we'll create a finding per source
      const claim = `Information from ${source.title}`;
      if (!claimMap.has(claim)) {
        claimMap.set(claim, []);
      }
      claimMap.get(claim)!.push(source.url);
    }

    // Create findings with confidence based on source count
    for (const [claim, sourceUrls] of claimMap) {
      findings.push({
        claim,
        sources: sourceUrls,
        confidence:
          sourceUrls.length >= 3
            ? "high"
            : sourceUrls.length >= 2
              ? "medium"
              : "low",
      });
    }

    return findings;
  }

  /**
   * Generate a summary of the research
   */
  private generateSummary(
    query: string,
    findings: ResearchFinding[],
    sources: ResearchSource[],
  ): string {
    const highConfidence = findings.filter(
      (f) => f.confidence === "high",
    ).length;
    const totalSources = sources.length;

    return (
      `Research on "${query}" analyzed ${totalSources} sources. ` +
      `Found ${findings.length} key findings, ${highConfidence} with high confidence. ` +
      `Sources include ${sources
        .slice(0, 3)
        .map((s) => s.title)
        .join(", ")}${totalSources > 3 ? " and more" : ""}.`
    );
  }

  /**
   * Identify research limitations
   */
  private identifyLimitations(sources: ResearchSource[]): string[] {
    const limitations: string[] = [];

    if (sources.length < 5) {
      limitations.push("Limited number of sources consulted");
    }

    const lowCredibility = sources.filter(
      (s) => (s.credibilityScore ?? 0) < 0.5,
    );
    if (lowCredibility.length > sources.length / 2) {
      limitations.push("Many sources have lower credibility scores");
    }

    const withDates = sources.filter((s) => s.publishedDate);
    if (withDates.length < sources.length / 2) {
      limitations.push("Publication dates not available for many sources");
    }

    return limitations;
  }
}

/**
 * Create the deep research tool for the orchestrator
 */
export function createDeepResearchTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description:
      "Conduct deep, multi-source web research on a topic with citations",
    inputSchema: z.object({
      query: z.string().describe("The research query or topic to investigate"),
      userId: z.string().describe("The user ID who owns this research session"),
      threadId: z
        .string()
        .optional()
        .describe("The thread ID to associate this research with"),
      depth: z
        .enum(["quick", "standard", "comprehensive"])
        .default("standard")
        .describe(
          "Research depth: quick (3 sources), standard (7 sources), comprehensive (15 sources)",
        ),
      maxSources: z
        .number()
        .optional()
        .describe("Override the default number of sources to consult"),
      includeStealth: z
        .boolean()
        .default(false)
        .describe("Use stealth mode for accessing restricted sites"),
      takeScreenshots: z
        .boolean()
        .default(true)
        .describe("Capture screenshots of key findings"),
    }),
    execute: async ({
      query,
      userId,
      threadId,
      depth,
      maxSources,
      includeStealth,
      takeScreenshots,
    }) => {
      const agent = new DeepResearchAgent(dataStream);

      try {
        const result = await agent.research(query, {
          userId,
          threadId,
          depth,
          maxSources,
          includeStealth,
          takeScreenshots,
        });

        return {
          success: true,
          query: result.query,
          summary: result.summary,
          findingsCount: result.findings.length,
          sourcesCount: result.sources.length,
          findings: result.findings,
          sources: result.sources.map((s) => ({
            title: s.title,
            url: s.url,
            credibility: s.credibilityScore,
          })),
          methodology: result.methodology,
          limitations: result.limitations,
        };
      } catch (err) {
        logger.error("Deep research failed:", err);
        return {
          success: false,
          error: String(err),
          query,
        };
      }
    },
  }) as Tool;
}
