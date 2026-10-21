export interface RowIdentity {
  credentialId?: string | null;
  distinctId: string | null;
  authorIdentity: string | null;
}

export const EMPTY_IDENTITY: RowIdentity = {
  credentialId: null,
  distinctId: null,
  authorIdentity: null,
};

export interface MetricsBatchInput {
  version: number;
  events: readonly unknown[];
}

export type MetricWriteStatus = "stored" | "duplicate" | "stale" | "error";

export interface MetricEventWriteResult {
  index: number;
  status: MetricWriteStatus;
  error?: string;
}

export interface MetricWriteResult {
  results: MetricEventWriteResult[];
}

export interface StoredMetricEvent {
  id: number;
  eventId: number;
  eventTs: number;
  repoUrl: string | null;
  repoKey: string | null;
  credentialId: string | null;
  author: string | null;
  commitSha: string | null;
  branch: string | null;
  tool: string | null;
  model: string | null;
  sessionId: string | null;
  raw: unknown;
  distinctId: string | null;
  authorIdentity: string | null;
}

export interface TokenUsageKey {
  sessionId: string;
  model: string;
  speed: number;
  bucketTs: number;
}

export interface TokenUsageRecord extends TokenUsageKey {
  id: number;
  emittedSeq: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cacheWrite1hTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  longContextInputTokens: number | null;
  longContextOutputTokens: number | null;
  longContextCacheReadTokens: number | null;
  longContextCacheWriteTokens: number | null;
  longContextCacheWrite1hTokens: number | null;
  estCostMicroUsd: number | null;
  transcriptCostMicroUsd: number | null;
  credits: number | null;
  messageCount: number | null;
  speedInferred: number | null;
  raw: unknown;
  repoUrl: string | null;
  repoKey: string | null;
  credentialId: string | null;
  author: string | null;
  commitSha: string | null;
  branch: string | null;
  tool: string | null;
  distinctId: string | null;
  authorIdentity: string | null;
}

export interface CasObjectInput {
  hash: string;
  content: unknown;
  metadata: Record<string, string>;
}

export interface CasWriteResultItem {
  hash: string;
  status: "stored" | "exists" | "error";
  error?: string;
}

export interface CasWriteResult {
  results: CasWriteResultItem[];
  successCount: number;
  failureCount: number;
}

export interface CasObjectRecord {
  id: number;
  hash: string;
  content: unknown;
  metadata: Record<string, string>;
  credentialId: string | null;
  repoUrl: string | null;
  repoKey: string | null;
  branch: string | null;
  distinctId: string | null;
  authorIdentity: string | null;
}

export interface NoteInput {
  commitSha: string;
  content: string;
}

export interface NoteWriteResult {
  successCount: number;
  failureCount: number;
}

export interface LogBatchInput {
  version: number;
  gitAiVersion: string | null;
  daemonId: string | null;
  installId: string | null;
  repoUrl: string | null;
  events: readonly unknown[];
}

export interface LogWriteError {
  index: number;
  error: string;
}

export interface LogWriteResult {
  accepted: number;
  dropped: number;
  errors: LogWriteError[];
}

export interface BundleInput {
  title: string;
  data: unknown;
}

export interface BundleRecord {
  id: string;
  body: unknown;
  createdAt: string;
  distinctId: string | null;
  authorIdentity: string | null;
  credentialId: string | null;
}

export type CredentialScope = "*" | readonly string[];

export interface ReadFilters {
  credentialId?: string;
  repoKey?: string;
  branch?: string;
  from?: number;
  to?: number;
  eventId?: number;
  limit: number;
  afterId?: number;
}

export interface NoteRecord {
  id: number;
  commitSha: string;
  content: string;
  credentialId: string | null;
}

/**
 * Persistence for accepted collector objects.
 * PostgreSQL can implement this same contract later; the SQLite schema is not a second design.
 * Each method is atomic: a database failure throws and leaves the previous rows unchanged.
 */
export interface CollectorStore {
  ping(): Promise<void>;
  close(): Promise<void>;
  writeMetrics(identity: RowIdentity, batch: MetricsBatchInput): Promise<MetricWriteResult>;
  findMetricEventsByCommit(commitSha: string): Promise<StoredMetricEvent[]>;
  listMetricEvents(scope: CredentialScope, filters: ReadFilters): Promise<StoredMetricEvent[]>;
  getTokenUsageBucket(key: TokenUsageKey): Promise<TokenUsageRecord | null>;
  putCasObjects(identity: RowIdentity, objects: readonly CasObjectInput[]): Promise<CasWriteResult>;
  getCasObjects(hashes: readonly string[], scope?: CredentialScope): Promise<CasObjectRecord[]>;
  listCasObjects(scope: CredentialScope, filters: ReadFilters): Promise<CasObjectRecord[]>;
  upsertNotes(identity: RowIdentity, entries: readonly NoteInput[]): Promise<NoteWriteResult>;
  getNotes(commitShas: readonly string[], scope?: CredentialScope): Promise<Record<string, string>>;
  listNotes(scope: CredentialScope, filters: ReadFilters): Promise<NoteRecord[]>;
  writeLogs(identity: RowIdentity, batch: LogBatchInput): Promise<LogWriteResult>;
  createBundle(identity: RowIdentity, bundle: BundleInput): Promise<BundleRecord>;
  getBundle(id: string, scope?: CredentialScope): Promise<BundleRecord | null>;
  listTokenUsage(scope: CredentialScope, filters: ReadFilters): Promise<TokenUsageRecord[]>;
}
