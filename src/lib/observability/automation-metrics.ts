/**
 * Automation Metrics and Observability
 *
 * Provides structured logging, metrics collection, and performance tracking
 * for browser and desktop automation operations.
 */

import { colorize } from "consola/utils";
import globalLogger from "logger";

/**
 * Metric types
 */
export enum MetricType {
  COUNTER = "counter",
  GAUGE = "gauge",
  HISTOGRAM = "histogram",
  TIMING = "timing",
}

/**
 * Automation event types
 */
export enum AutomationEvent {
  // Session lifecycle
  SESSION_CREATED = "session.created",
  SESSION_CLOSED = "session.closed",
  SESSION_ERROR = "session.error",
  SESSION_TIMEOUT = "session.timeout",
  SESSION_CLEANUP = "session.cleanup",

  // Browser operations
  BROWSER_NAVIGATE = "browser.navigate",
  BROWSER_ACT = "browser.act",
  BROWSER_EXTRACT = "browser.extract",
  BROWSER_SCREENSHOT = "browser.screenshot",
  BROWSER_OBSERVE = "browser.observe",

  // Desktop operations
  DESKTOP_SCREENSHOT = "desktop.screenshot",
  DESKTOP_CLICK = "desktop.click",
  DESKTOP_TYPE = "desktop.type",
  DESKTOP_SCROLL = "desktop.scroll",

  // Rate limiting
  RATE_LIMIT_HIT = "ratelimit.hit",
  QUOTA_EXCEEDED = "quota.exceeded",

  // Errors
  PROVIDER_ERROR = "provider.error",
  VALIDATION_ERROR = "validation.error",
  STORAGE_ERROR = "storage.error",
}

/**
 * Metric context
 */
export interface MetricContext {
  userId?: string;
  sessionId?: string;
  threadId?: string;
  provider?: "browserbase" | "e2b-desktop";
  operation?: string;
  [key: string]: unknown;
}

/**
 * Performance timing entry
 */
interface TimingEntry {
  startTime: number;
  context: MetricContext;
}

// In-memory metrics store (would be replaced with external service in production)
const metricsStore = {
  counters: new Map<string, number>(),
  gauges: new Map<string, number>(),
  histograms: new Map<string, number[]>(),
  timings: new Map<string, number[]>(),
};

// Active timing operations
const activeTimings = new Map<string, TimingEntry>();

// Logger instances
const browserLogger = globalLogger.withDefaults({
  message: colorize("magenta", "[Browser Metrics] "),
});

const desktopLogger = globalLogger.withDefaults({
  message: colorize("yellow", "[Desktop Metrics] "),
});

const systemLogger = globalLogger.withDefaults({
  message: colorize("blue", "[Automation Metrics] "),
});

/**
 * Get the appropriate logger for a provider
 */
function getLogger(provider?: string) {
  if (provider === "browserbase") return browserLogger;
  if (provider === "e2b-desktop") return desktopLogger;
  return systemLogger;
}

/**
 * Increment a counter metric
 */
export function incrementCounter(
  name: string,
  value: number = 1,
  context?: MetricContext,
): void {
  const key = `${name}`;
  const current = metricsStore.counters.get(key) || 0;
  metricsStore.counters.set(key, current + value);

  if (context) {
    getLogger(context.provider).debug(`Counter ${name}: +${value}`, context);
  }
}

/**
 * Set a gauge metric
 */
export function setGauge(
  name: string,
  value: number,
  context?: MetricContext,
): void {
  metricsStore.gauges.set(name, value);

  if (context) {
    getLogger(context.provider).debug(`Gauge ${name}: ${value}`, context);
  }
}

/**
 * Record a histogram value
 */
export function recordHistogram(
  name: string,
  value: number,
  context?: MetricContext,
): void {
  const existing = metricsStore.histograms.get(name) || [];
  existing.push(value);

  // Keep only last 1000 values
  if (existing.length > 1000) {
    existing.shift();
  }

  metricsStore.histograms.set(name, existing);

  if (context) {
    getLogger(context.provider).debug(`Histogram ${name}: ${value}`, context);
  }
}

/**
 * Start a timing operation
 */
export function startTiming(
  operationId: string,
  context?: MetricContext,
): void {
  activeTimings.set(operationId, {
    startTime: performance.now(),
    context: context || {},
  });
}

/**
 * End a timing operation and record the duration
 */
export function endTiming(
  operationId: string,
  metricName?: string,
): number | null {
  const entry = activeTimings.get(operationId);
  if (!entry) {
    return null;
  }

  const duration = performance.now() - entry.startTime;
  activeTimings.delete(operationId);

  // Record in timings store
  const name = metricName || operationId;
  const existing = metricsStore.timings.get(name) || [];
  existing.push(duration);

  // Keep only last 1000 values
  if (existing.length > 1000) {
    existing.shift();
  }

  metricsStore.timings.set(name, existing);

  getLogger(entry.context.provider).debug(
    `Timing ${name}: ${duration.toFixed(2)}ms`,
    entry.context,
  );

  return duration;
}

/**
 * Log an automation event with structured data
 */
export function logEvent(
  event: AutomationEvent,
  context: MetricContext,
  data?: Record<string, unknown>,
): void {
  const logger = getLogger(context.provider);
  const logData = {
    event,
    ...context,
    ...data,
    timestamp: new Date().toISOString(),
  };

  // Determine log level based on event type
  if (event.includes("error") || event.includes("timeout")) {
    logger.error(event, logData);
  } else if (event.includes("limit") || event.includes("exceeded")) {
    logger.warn(event, logData);
  } else {
    logger.info(event, logData);
  }

  // Increment event counter
  incrementCounter(`events.${event}`, 1, context);
}

/**
 * Log session creation
 */
export function logSessionCreated(
  sessionId: string,
  provider: "browserbase" | "e2b-desktop",
  context: {
    userId: string;
    threadId?: string;
    options?: Record<string, unknown>;
  },
): void {
  logEvent(
    AutomationEvent.SESSION_CREATED,
    {
      sessionId,
      provider,
      userId: context.userId,
      threadId: context.threadId,
    },
    { options: context.options },
  );

  incrementCounter(`sessions.created.${provider}`);

  // Update active sessions gauge
  const activeKey = `sessions.active.${provider}`;
  const currentActive = metricsStore.gauges.get(activeKey) || 0;
  setGauge(activeKey, currentActive + 1);
}

/**
 * Log session closed
 */
export function logSessionClosed(
  sessionId: string,
  provider: "browserbase" | "e2b-desktop",
  context: {
    userId?: string;
    reason?: string;
    durationMs?: number;
  },
): void {
  logEvent(
    AutomationEvent.SESSION_CLOSED,
    {
      sessionId,
      provider,
      userId: context.userId,
    },
    {
      reason: context.reason,
      durationMs: context.durationMs,
    },
  );

  incrementCounter(`sessions.closed.${provider}`);

  // Update active sessions gauge
  const activeKey = `sessions.active.${provider}`;
  const currentActive = metricsStore.gauges.get(activeKey) || 0;
  setGauge(activeKey, Math.max(0, currentActive - 1));

  // Record session duration
  if (context.durationMs) {
    recordHistogram(`sessions.duration.${provider}`, context.durationMs);
  }
}

/**
 * Log session error
 */
export function logSessionError(
  sessionId: string,
  provider: "browserbase" | "e2b-desktop",
  error: Error | string,
  context?: MetricContext,
): void {
  logEvent(
    AutomationEvent.SESSION_ERROR,
    {
      sessionId,
      provider,
      ...context,
    },
    {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    },
  );

  incrementCounter(`errors.session.${provider}`);
}

/**
 * Log browser navigation
 */
export function logBrowserNavigation(
  sessionId: string,
  url: string,
  context: {
    userId?: string;
    durationMs?: number;
    success: boolean;
  },
): void {
  logEvent(
    AutomationEvent.BROWSER_NAVIGATE,
    {
      sessionId,
      provider: "browserbase",
      userId: context.userId,
    },
    {
      url,
      durationMs: context.durationMs,
      success: context.success,
    },
  );

  incrementCounter("browser.navigations");

  if (context.durationMs) {
    recordHistogram("browser.navigation.duration", context.durationMs);
  }
}

/**
 * Log browser action (Stagehand act)
 */
export function logBrowserAction(
  sessionId: string,
  action: string,
  context: {
    userId?: string;
    durationMs?: number;
    success: boolean;
  },
): void {
  logEvent(
    AutomationEvent.BROWSER_ACT,
    {
      sessionId,
      provider: "browserbase",
      userId: context.userId,
    },
    {
      action,
      durationMs: context.durationMs,
      success: context.success,
    },
  );

  incrementCounter("browser.actions");

  if (context.durationMs) {
    recordHistogram("browser.action.duration", context.durationMs);
  }
}

/**
 * Log browser screenshot
 */
export function logBrowserScreenshot(
  sessionId: string,
  context: {
    userId?: string;
    sizeBytes?: number;
    durationMs?: number;
    fullPage?: boolean;
  },
): void {
  logEvent(
    AutomationEvent.BROWSER_SCREENSHOT,
    {
      sessionId,
      provider: "browserbase",
      userId: context.userId,
    },
    {
      sizeBytes: context.sizeBytes,
      durationMs: context.durationMs,
      fullPage: context.fullPage,
    },
  );

  incrementCounter("browser.screenshots");

  if (context.sizeBytes) {
    recordHistogram("screenshots.size.browserbase", context.sizeBytes);
  }
}

/**
 * Log browser error
 */
export function logBrowserError(
  sessionId: string,
  operation: string,
  error: string,
  context?: MetricContext,
): void {
  logEvent(
    AutomationEvent.PROVIDER_ERROR,
    {
      sessionId,
      provider: "browserbase",
      operation,
      ...context,
    },
    { error },
  );

  incrementCounter(`errors.browser.${operation}`);
}

/**
 * Log screenshot capture
 */
export function logScreenshot(
  sessionId: string,
  provider: "browserbase" | "e2b-desktop",
  context: {
    userId?: string;
    sizeBytes?: number;
    durationMs?: number;
    success: boolean;
  },
): void {
  const event =
    provider === "browserbase"
      ? AutomationEvent.BROWSER_SCREENSHOT
      : AutomationEvent.DESKTOP_SCREENSHOT;

  logEvent(
    event,
    {
      sessionId,
      provider,
      userId: context.userId,
    },
    {
      sizeBytes: context.sizeBytes,
      durationMs: context.durationMs,
      success: context.success,
    },
  );

  incrementCounter(`screenshots.${provider}`);

  if (context.sizeBytes) {
    recordHistogram(`screenshots.size.${provider}`, context.sizeBytes);
  }

  if (context.durationMs) {
    recordHistogram(`screenshots.duration.${provider}`, context.durationMs);
  }
}

/**
 * Log rate limit hit
 */
export function logRateLimitHit(
  userId: string,
  limitType: string,
  context?: MetricContext,
): void {
  logEvent(
    AutomationEvent.RATE_LIMIT_HIT,
    {
      userId,
      ...context,
    },
    { limitType },
  );

  incrementCounter(`ratelimit.${limitType}`);
}

/**
 * Log quota exceeded
 */
export function logQuotaExceeded(
  userId: string,
  quotaType: string,
  current: number,
  max: number,
): void {
  logEvent(
    AutomationEvent.QUOTA_EXCEEDED,
    { userId },
    { quotaType, current, max },
  );

  incrementCounter(`quota.exceeded.${quotaType}`);
}

/**
 * Get current metrics summary
 */
export function getMetricsSummary(): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<
    string,
    { count: number; avg: number; p50: number; p95: number; p99: number }
  >;
  timings: Record<
    string,
    { count: number; avg: number; p50: number; p95: number; p99: number }
  >;
} {
  const calculatePercentiles = (values: number[]) => {
    if (values.length === 0) {
      return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const avg = sorted.reduce((a, b) => a + b, 0) / count;
    const p50 = sorted[Math.floor(count * 0.5)];
    const p95 = sorted[Math.floor(count * 0.95)];
    const p99 = sorted[Math.floor(count * 0.99)];

    return { count, avg, p50, p95, p99 };
  };

  const counters: Record<string, number> = {};
  for (const [key, value] of metricsStore.counters) {
    counters[key] = value;
  }

  const gauges: Record<string, number> = {};
  for (const [key, value] of metricsStore.gauges) {
    gauges[key] = value;
  }

  const histograms: Record<
    string,
    { count: number; avg: number; p50: number; p95: number; p99: number }
  > = {};
  for (const [key, values] of metricsStore.histograms) {
    histograms[key] = calculatePercentiles(values);
  }

  const timings: Record<
    string,
    { count: number; avg: number; p50: number; p95: number; p99: number }
  > = {};
  for (const [key, values] of metricsStore.timings) {
    timings[key] = calculatePercentiles(values);
  }

  return { counters, gauges, histograms, timings };
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  metricsStore.counters.clear();
  metricsStore.gauges.clear();
  metricsStore.histograms.clear();
  metricsStore.timings.clear();
  activeTimings.clear();
}

/**
 * Wrapper to time an async operation
 */
export async function timeOperation<T>(
  name: string,
  operation: () => Promise<T>,
  context?: MetricContext,
): Promise<T> {
  const operationId = `${name}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  startTiming(operationId, context);

  try {
    const result = await operation();
    endTiming(operationId, name);
    return result;
  } catch (error) {
    endTiming(operationId, `${name}.error`);
    throw error;
  }
}
