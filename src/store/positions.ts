/** Sparse attribute positions shared by every metric event. */
export const ATTR = {
  repoUrl: 1,
  author: 2,
  commitSha: 3,
  branch: 5,
  tool: 20,
  model: 21,
  sessionId: 24,
} as const;

/** Sparse value positions for metric event id 9 (token usage). */
export const TOKEN_VALUE = {
  bucketTs: 0,
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  totalTokens: 5,
  reasoningOutputTokens: 6,
  estCostMicroUsd: 7,
  credits: 8,
  messageCount: 9,
  emittedSeq: 10,
  speed: 11,
  speedInferred: 12,
  cacheWrite1hTokens: 13,
  longContextInputTokens: 14,
  longContextOutputTokens: 15,
  longContextCacheReadTokens: 16,
  longContextCacheWriteTokens: 17,
  longContextCacheWrite1hTokens: 18,
  transcriptCostMicroUsd: 19,
} as const;

export const METRIC_EVENT_ID = {
  committed: 1,
  agentUsage: 2,
  installHooks: 3,
  checkpoint: 4,
  sessionEvent: 5,
  otelTrace: 6,
  rewriteCommitted: 7,
  daemonIngestAnomaly: 8,
  tokenUsage: 9,
} as const;

export const MAX_METRIC_EVENTS = 1000;
export const METRICS_VERSION = 1;
export const LOGS_VERSION = 1;
export const STANDARD_SPEED = 0;

export const LOG_KINDS = ["log", "heartbeat"] as const;
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
