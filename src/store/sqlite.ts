import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

import { CollectorStoreError } from "./errors.js";
import { parseLogEvent, parseMetricEvent, parseTokenUsage, type ParsedMetricEvent, type ParsedTokenUsage } from "./parse.js";
import { LOGS_VERSION, MAX_METRIC_EVENTS, METRIC_EVENT_ID, METRICS_VERSION } from "./positions.js";
import type {
  BundleInput,
  BundleRecord,
  CasObjectInput,
  CasObjectRecord,
  CasWriteResult,
  CasWriteResultItem,
  CollectorStore,
  CredentialScope,
  LogBatchInput,
  LogWriteResult,
  MetricEventWriteResult,
  MetricWriteResult,
  MetricsBatchInput,
  NoteInput,
  NoteRecord,
  NoteWriteResult,
  RowIdentity,
  ReadFilters,
  StoredMetricEvent,
  TokenUsageKey,
  TokenUsageRecord,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS metric_hashes (
  event_hash TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_events (
  id INTEGER PRIMARY KEY,
  event_hash TEXT NOT NULL UNIQUE,
  event_ts INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  repo_url TEXT,
  repo_key TEXT,
  author TEXT,
  commit_sha TEXT,
  branch TEXT,
  tool TEXT,
  model TEXT,
  session_id TEXT,
  distinct_id TEXT,
  author_identity TEXT,
  credential_id TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS metric_events_commit_sha ON metric_events(commit_sha);
CREATE INDEX IF NOT EXISTS metric_events_session_id ON metric_events(session_id);
CREATE INDEX IF NOT EXISTS metric_events_repo_url ON metric_events(repo_url);
CREATE INDEX IF NOT EXISTS metric_events_event_id ON metric_events(event_id);
CREATE INDEX IF NOT EXISTS metric_events_credential_id ON metric_events(credential_id);
CREATE INDEX IF NOT EXISTS metric_events_repo_key_branch ON metric_events(repo_key, branch);

CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  speed INTEGER NOT NULL,
  bucket_ts INTEGER NOT NULL,
  emitted_seq INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  cache_write_1h_tokens INTEGER,
  reasoning_output_tokens INTEGER,
  total_tokens INTEGER,
  long_context_input_tokens INTEGER,
  long_context_output_tokens INTEGER,
  long_context_cache_read_tokens INTEGER,
  long_context_cache_write_tokens INTEGER,
  long_context_cache_write_1h_tokens INTEGER,
  est_cost_micro_usd INTEGER,
  transcript_cost_micro_usd INTEGER,
  credits REAL,
  message_count INTEGER,
  speed_inferred INTEGER,
  event_hash TEXT NOT NULL,
  event_ts INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  repo_url TEXT,
  repo_key TEXT,
  author TEXT,
  commit_sha TEXT,
  branch TEXT,
  tool TEXT,
  distinct_id TEXT,
  author_identity TEXT,
  credential_id TEXT,
  received_at TEXT NOT NULL,
  UNIQUE (credential_id, session_id, model, speed, bucket_ts)
);

CREATE TABLE IF NOT EXISTS cas_objects (
  hash TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  repo_url TEXT,
  repo_key TEXT,
  branch TEXT,
  distinct_id TEXT,
  author_identity TEXT,
  credential_id TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  commit_sha TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  distinct_id TEXT,
  author_identity TEXT,
  credential_id TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS log_events (
  id INTEGER PRIMARY KEY,
  event_id TEXT UNIQUE,
  kind TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  level TEXT NOT NULL,
  target TEXT,
  message TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  repo_url TEXT,
  repo_key TEXT,
  git_ai_version TEXT,
  daemon_id TEXT,
  install_id TEXT,
  raw_json TEXT NOT NULL,
  distinct_id TEXT,
  author_identity TEXT,
  credential_id TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL,
  distinct_id TEXT,
  author_identity TEXT,
  credential_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS token_usage_credential_id ON token_usage(credential_id);
CREATE INDEX IF NOT EXISTS token_usage_repo_key_branch ON token_usage(repo_key, branch);
CREATE INDEX IF NOT EXISTS cas_objects_credential_id ON cas_objects(credential_id);
CREATE INDEX IF NOT EXISTS cas_objects_repo_key_branch ON cas_objects(repo_key, branch);
CREATE INDEX IF NOT EXISTS notes_credential_id ON notes(credential_id);
CREATE INDEX IF NOT EXISTS log_events_credential_id ON log_events(credential_id);
CREATE INDEX IF NOT EXISTS log_events_repo_key ON log_events(repo_key);
CREATE INDEX IF NOT EXISTS bundles_credential_id ON bundles(credential_id);
`;

interface Statements {
  selectHash: StatementSync;
  insertHash: StatementSync;
  insertMetric: StatementSync;
  selectMetricsByCommit: StatementSync;
  selectToken: StatementSync;
  insertToken: StatementSync;
  updateToken: StatementSync;
  selectTokenBucket: StatementSync;
  selectCas: StatementSync;
  insertCas: StatementSync;
  upsertNote: StatementSync;
  selectLogId: StatementSync;
  insertLog: StatementSync;
  insertBundle: StatementSync;
  selectBundle: StatementSync;
}

interface TokenRow extends ParsedTokenUsage {
  eventHash: string;
  eventTs: number;
  rawJson: string;
  repoUrl: string | null;
  repoKey: string | null;
  author: string | null;
  commitSha: string | null;
  branch: string | null;
  tool: string | null;
  distinctId: string | null;
  authorIdentity: string | null;
  credentialId: string | null;
  receivedAt: string;
}

export class SqliteCollectorStore implements CollectorStore {
  private readonly db: DatabaseSync;
  private readonly memory: boolean;
  private readonly statements: Statements;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(sqlitePath: string) {
    const location = sqlitePath === ":memory:" ? ":memory:" : resolve(sqlitePath);
    this.memory = location === ":memory:";
    if (!this.memory) mkdirSync(dirname(location), { recursive: true });
    this.db = new DatabaseSync(location);
    try {
      this.configure();
      this.migrate();
      this.statements = this.prepare();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  ping(): Promise<void> {
    return this.exclusive(() => {
      this.db.prepare("SELECT 1 AS ok").get();
    });
  }

  close(): Promise<void> {
    return this.exclusive(() => {
      if (this.closed) return;
      this.closed = true;
      this.db.close();
    }, true);
  }

  writeMetrics(identity: RowIdentity, batch: MetricsBatchInput): Promise<MetricWriteResult> {
    return this.exclusive(() => this.writeMetricsSync(identity, batch));
  }

  findMetricEventsByCommit(commitSha: string): Promise<StoredMetricEvent[]> {
    return this.exclusive(() => {
      const rows = this.statements.selectMetricsByCommit.all(commitSha);
      return rows.map((row) => this.metricFromRow(asRecord(row)));
    });
  }

  getTokenUsageBucket(key: TokenUsageKey): Promise<TokenUsageRecord | null> {
    return this.exclusive(() => {
      const row = this.statements.selectTokenBucket.get(key.sessionId, key.model, key.speed, key.bucketTs);
      if (row === undefined) return null;
      return this.tokenFromRow(asRecord(row));
    });
  }

  listMetricEvents(scope: CredentialScope, filters: ReadFilters): Promise<StoredMetricEvent[]> {
    return this.exclusive(() => {
      const where = readWhere(scope, filters, { eventTs: "event_ts", eventId: "event_id", repoKey: "repo_key", branch: "branch" });
      const rows = this.db.prepare(
        `SELECT id, event_id, event_ts, raw_json, repo_url, repo_key, author, commit_sha, branch, tool, model, session_id,
                distinct_id, author_identity, credential_id FROM metric_events${where.sql} ORDER BY id LIMIT ?`,
      ).all(...where.values, filters.limit);
      return rows.map((row) => this.metricFromRow(asRecord(row)));
    });
  }

  listTokenUsage(scope: CredentialScope, filters: ReadFilters): Promise<TokenUsageRecord[]> {
    return this.exclusive(() => {
      const where = readWhere(scope, filters, { eventTs: "bucket_ts", repoKey: "repo_key", branch: "branch" });
      const rows = this.db.prepare(
        `SELECT id, session_id, model, speed, bucket_ts, emitted_seq,
                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cache_write_1h_tokens,
                reasoning_output_tokens, total_tokens, long_context_input_tokens, long_context_output_tokens,
                long_context_cache_read_tokens, long_context_cache_write_tokens, long_context_cache_write_1h_tokens,
                est_cost_micro_usd, transcript_cost_micro_usd, credits, message_count, speed_inferred,
                raw_json, repo_url, repo_key, author, commit_sha, branch, tool, distinct_id, author_identity, credential_id
         FROM token_usage${where.sql} ORDER BY id LIMIT ?`,
      ).all(...where.values, filters.limit);
      return rows.map((row) => this.tokenFromRow(asRecord(row)));
    });
  }

  putCasObjects(identity: RowIdentity, objects: readonly CasObjectInput[]): Promise<CasWriteResult> {
    return this.exclusive(() => this.putCasObjectsSync(identity, objects));
  }

  getCasObjects(hashes: readonly string[], scope: CredentialScope = "*"): Promise<CasObjectRecord[]> {
    return this.exclusive(() => {
      if (hashes.length === 0) return [];
      const found = new Map<string, CasObjectRecord>();
      const access = scopeSql(scope, "credential_id");
      const statement = this.db.prepare(
        `SELECT rowid AS id, hash, content_json, metadata_json, distinct_id, author_identity, credential_id, repo_url, repo_key, branch
         FROM cas_objects WHERE hash IN (${placeholders(hashes.length)})${access.sql}`,
      );
      for (const row of statement.all(...hashes, ...access.values)) {
        const record = asRecord(row);
        const hash = textColumn(record, "hash");
        found.set(hash, {
          id: integerColumn(record, "id"),
          hash,
          content: JSON.parse(textColumn(record, "content_json")) as unknown,
          metadata: stringRecord(JSON.parse(textColumn(record, "metadata_json")) as unknown),
          distinctId: nullableText(record, "distinct_id"),
          authorIdentity: nullableText(record, "author_identity"),
          credentialId: nullableText(record, "credential_id"),
          repoUrl: nullableText(record, "repo_url"),
          repoKey: nullableText(record, "repo_key"),
          branch: nullableText(record, "branch"),
        });
      }
      const records: CasObjectRecord[] = [];
      for (const hash of hashes) {
        const record = found.get(hash);
        if (record) records.push(record);
      }
      return records;
    });
  }

  listCasObjects(scope: CredentialScope, filters: ReadFilters): Promise<CasObjectRecord[]> {
    return this.exclusive(() => {
      const where = readWhere(scope, filters, { repoKey: "repo_key", branch: "branch", id: "rowid" });
      const rows = this.db.prepare(
        `SELECT rowid AS id, hash, content_json, metadata_json, credential_id, repo_url, repo_key, branch, distinct_id, author_identity
         FROM cas_objects${where.sql} ORDER BY rowid LIMIT ?`,
      ).all(...where.values, filters.limit);
      return rows.map((value) => {
        const row = asRecord(value);
        return {
          id: integerColumn(row, "id"),
          hash: textColumn(row, "hash"),
          content: JSON.parse(textColumn(row, "content_json")) as unknown,
          metadata: stringRecord(JSON.parse(textColumn(row, "metadata_json")) as unknown),
          credentialId: nullableText(row, "credential_id"),
          repoUrl: nullableText(row, "repo_url"),
          repoKey: nullableText(row, "repo_key"),
          branch: nullableText(row, "branch"),
          distinctId: nullableText(row, "distinct_id"),
          authorIdentity: nullableText(row, "author_identity"),
        };
      });
    });
  }

  upsertNotes(identity: RowIdentity, entries: readonly NoteInput[]): Promise<NoteWriteResult> {
    return this.exclusive(() => this.upsertNotesSync(identity, entries));
  }

  getNotes(commitShas: readonly string[], scope: CredentialScope = "*"): Promise<Record<string, string>> {
    return this.exclusive(() => {
      if (commitShas.length === 0) return {};
      const access = scopeSql(scope, "credential_id");
      const statement = this.db.prepare(`SELECT commit_sha, content FROM notes WHERE commit_sha IN (${placeholders(commitShas.length)})${access.sql}`);
      const notes: Record<string, string> = {};
      for (const row of statement.all(...commitShas, ...access.values)) {
        const record = asRecord(row);
        notes[textColumn(record, "commit_sha")] = textColumn(record, "content");
      }
      return notes;
    });
  }

  listNotes(scope: CredentialScope, filters: ReadFilters): Promise<NoteRecord[]> {
    return this.exclusive(() => {
      const where = readWhere(scope, filters, { id: "rowid" });
      const rows = this.db.prepare(`SELECT rowid AS id, commit_sha, content, credential_id FROM notes${where.sql} ORDER BY rowid LIMIT ?`)
        .all(...where.values, filters.limit);
      return rows.map((value) => {
        const row = asRecord(value);
        return { id: integerColumn(row, "id"), commitSha: textColumn(row, "commit_sha"), content: textColumn(row, "content"), credentialId: nullableText(row, "credential_id") };
      });
    });
  }

  writeLogs(identity: RowIdentity, batch: LogBatchInput): Promise<LogWriteResult> {
    return this.exclusive(() => this.writeLogsSync(identity, batch));
  }

  createBundle(identity: RowIdentity, bundle: BundleInput): Promise<BundleRecord> {
    return this.exclusive(() => {
      const title = bundle.title.trim();
      if (title.length === 0) throw new CollectorStoreError("bundle title is required");
      const createdAt = new Date().toISOString();
      const body = { title, data: bundle.data };
      const id = randomUUID();
      return this.withTransaction(() => {
        this.statements.insertBundle.run(
          id,
          title,
          JSON.stringify(body),
          identity.distinctId,
          identity.authorIdentity,
          identity.credentialId ?? null,
          createdAt,
        );
        return {
          id,
          body,
          createdAt,
          distinctId: identity.distinctId,
          authorIdentity: identity.authorIdentity,
          credentialId: identity.credentialId ?? null,
        };
      });
    });
  }

  getBundle(id: string, scope: CredentialScope = "*"): Promise<BundleRecord | null> {
    return this.exclusive(() => {
      const access = scopeSql(scope, "credential_id");
      const row = this.db.prepare(`SELECT id, body_json, distinct_id, author_identity, credential_id, created_at FROM bundles WHERE id = ?${access.sql}`).get(id, ...access.values);
      if (row === undefined) return null;
      const record = asRecord(row);
      return {
        id: textColumn(record, "id"),
        body: JSON.parse(textColumn(record, "body_json")) as unknown,
        createdAt: textColumn(record, "created_at"),
        distinctId: nullableText(record, "distinct_id"),
        authorIdentity: nullableText(record, "author_identity"),
        credentialId: nullableText(record, "credential_id"),
      };
    });
  }

  private writeMetricsSync(identity: RowIdentity, batch: MetricsBatchInput): MetricWriteResult {
    if (batch.version !== METRICS_VERSION) {
      throw new CollectorStoreError("unsupported metrics version");
    }
    if (!Array.isArray(batch.events)) {
      throw new CollectorStoreError("metrics events must be an array");
    }
    if (batch.events.length > MAX_METRIC_EVENTS) {
      throw new CollectorStoreError("metrics batch exceeds 1000 events");
    }

    const receivedAt = new Date().toISOString();
    return this.withTransaction(() => {
      const results: MetricEventWriteResult[] = [];
      for (let index = 0; index < batch.events.length; index += 1) {
        results.push(this.applyMetricEvent(identity, batch.events[index], index, receivedAt));
      }
      return { results };
    });
  }

  private applyMetricEvent(
    identity: RowIdentity,
    raw: unknown,
    index: number,
    receivedAt: string,
  ): MetricEventWriteResult {
    const parsed = parseMetricEvent(raw);
    if (!parsed.ok) return { index, status: "error", error: parsed.error };
    const event = parsed.event;
    if (this.statements.selectHash.get(event.hash) !== undefined) {
      return { index, status: "duplicate" };
    }

    if (event.eventId === METRIC_EVENT_ID.tokenUsage) {
      const token = parseTokenUsage(event);
      if (!token.ok) return { index, status: "error", error: token.error };
      return this.applyTokenUsage(identity, event, token.token, index, receivedAt);
    }

    this.insertMetric(identity, event, receivedAt);
    return { index, status: "stored" };
  }

  private applyTokenUsage(
    identity: RowIdentity,
    event: ParsedMetricEvent,
    token: ParsedTokenUsage,
    index: number,
    receivedAt: string,
  ): MetricEventWriteResult {
    const existing = this.statements.selectToken.get(
      identity.credentialId ?? null,
      token.sessionId,
      token.model,
      token.speed,
      token.bucketTs,
    );
    const currentSeq = existing === undefined ? null : integerColumn(asRecord(existing), "emitted_seq");
    if (currentSeq !== null && currentSeq >= token.emittedSeq) {
      this.statements.insertHash.run(event.hash, event.eventId);
      return { index, status: "stale" };
    }

    const row = tokenRow(identity, event, token, receivedAt);
    const values = tokenValues(row);
    if (existing === undefined) {
      this.statements.insertToken.run(...values);
    } else {
      this.statements.updateToken.run(...values.slice(4), identity.credentialId ?? null, ...values.slice(0, 4));
    }
    this.insertMetric(identity, event, receivedAt);
    return { index, status: "stored" };
  }

  private insertMetric(identity: RowIdentity, event: ParsedMetricEvent, receivedAt: string): void {
    this.statements.insertHash.run(event.hash, event.eventId);
    this.statements.insertMetric.run(
      event.hash,
      event.eventTs,
      event.eventId,
      JSON.stringify(event.raw),
      event.common.repoUrl,
      repoKey(event.common.repoUrl),
      event.common.author,
      event.common.commitSha,
      event.common.branch,
      event.common.tool,
      event.common.model,
      event.common.sessionId,
      identity.distinctId,
      identity.authorIdentity,
      identity.credentialId ?? null,
      receivedAt,
    );
  }

  private putCasObjectsSync(identity: RowIdentity, objects: readonly CasObjectInput[]): CasWriteResult {
    const receivedAt = new Date().toISOString();
    return this.withTransaction(() => {
      const results: CasWriteResultItem[] = [];
      let successCount = 0;
      let failureCount = 0;
      for (const object of objects) {
        const hash = typeof object.hash === "string" ? object.hash.trim() : "";
        if (hash.length === 0) {
          failureCount += 1;
          results.push({
            hash: typeof object.hash === "string" ? object.hash : "",
            status: "error",
            error: "cas object is missing hash",
          });
          continue;
        }
        if (object.content === undefined) {
          failureCount += 1;
          results.push({ hash, status: "error", error: "cas object is missing content" });
          continue;
        }
        const metadata = object.metadata ?? {};
        const existing = this.statements.selectCas.get(hash);
        if (existing !== undefined) {
          successCount += 1;
          results.push({ hash, status: "exists" });
          continue;
        }
        this.statements.insertCas.run(
          hash,
          JSON.stringify(object.content),
          JSON.stringify(metadata),
          JSON.stringify({ hash, content: object.content, metadata }),
          nullableMetadata(metadata, "repo_url"),
          repoKey(nullableMetadata(metadata, "repo_url")),
          nullableMetadata(metadata, "branch"),
          identity.distinctId,
          identity.authorIdentity,
          identity.credentialId ?? null,
          receivedAt,
        );
        successCount += 1;
        results.push({ hash, status: "stored" });
      }
      return { results, successCount, failureCount };
    });
  }

  private upsertNotesSync(identity: RowIdentity, entries: readonly NoteInput[]): NoteWriteResult {
    const receivedAt = new Date().toISOString();
    return this.withTransaction(() => {
      let successCount = 0;
      let failureCount = 0;
      for (const entry of entries) {
        const commitSha = entry.commitSha.trim();
        if (commitSha.length === 0 || typeof entry.content !== "string") {
          failureCount += 1;
          continue;
        }
        this.statements.upsertNote.run(
          commitSha,
          entry.content,
          identity.distinctId,
          identity.authorIdentity,
          identity.credentialId ?? null,
          receivedAt,
        );
        successCount += 1;
      }
      return { successCount, failureCount };
    });
  }

  private writeLogsSync(identity: RowIdentity, batch: LogBatchInput): LogWriteResult {
    if (batch.version !== LOGS_VERSION) {
      throw new CollectorStoreError("unsupported logs version");
    }
    if (!Array.isArray(batch.events)) {
      throw new CollectorStoreError("log events must be an array");
    }
    const receivedAt = new Date().toISOString();
    return this.withTransaction(() => {
      let accepted = 0;
      let dropped = 0;
      const errors: LogWriteResult["errors"] = [];
      for (let index = 0; index < batch.events.length; index += 1) {
        const parsed = parseLogEvent(batch.events[index]);
        if (!parsed.ok) {
          errors.push({ index, error: parsed.error });
          continue;
        }
        const event = parsed.event;
        if (event.eventId !== null && this.statements.selectLogId.get(event.eventId) !== undefined) {
          dropped += 1;
          continue;
        }
        this.statements.insertLog.run(
          event.eventId,
          event.kind,
          event.timestamp,
          event.level,
          event.target,
          event.message,
          event.fieldsJson,
          event.repoUrl ?? batch.repoUrl,
          repoKey(event.repoUrl ?? batch.repoUrl),
          event.gitAiVersion ?? batch.gitAiVersion,
          batch.daemonId,
          batch.installId,
          event.rawJson,
          identity.distinctId,
          identity.authorIdentity,
          identity.credentialId ?? null,
          receivedAt,
        );
        accepted += 1;
      }
      return { accepted, dropped, errors };
    });
  }

  private configure(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (!this.memory) {
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
    }
  }

  private migrate(): void {
    const version = integerColumn(asRecord(this.db.prepare("PRAGMA user_version").get()), "user_version");
    if (version > 2) {
      throw new Error(`unsupported schema version ${version}`);
    }
    if (version === 0) {
      this.db.exec(SCHEMA);
      this.db.exec("PRAGMA user_version = 2");
      return;
    }
    if (version === 1) {
      for (const [table, columns] of Object.entries({
        metric_events: ["credential_id TEXT", "repo_key TEXT"],
        token_usage: ["credential_id TEXT", "repo_key TEXT"],
        cas_objects: ["credential_id TEXT", "repo_url TEXT", "repo_key TEXT", "branch TEXT"],
        notes: ["credential_id TEXT"],
        log_events: ["credential_id TEXT", "repo_key TEXT"],
        bundles: ["credential_id TEXT"],
      })) {
        for (const column of columns) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
      }
      this.db.exec(SCHEMA);
      this.db.exec("PRAGMA user_version = 2");
    }
  }

  private prepare(): Statements {
    const tokenColumns = [
      "session_id",
      "model",
      "speed",
      "bucket_ts",
      "emitted_seq",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "cache_write_1h_tokens",
      "reasoning_output_tokens",
      "total_tokens",
      "long_context_input_tokens",
      "long_context_output_tokens",
      "long_context_cache_read_tokens",
      "long_context_cache_write_tokens",
      "long_context_cache_write_1h_tokens",
      "est_cost_micro_usd",
      "transcript_cost_micro_usd",
      "credits",
      "message_count",
      "speed_inferred",
      "event_hash",
      "event_ts",
      "raw_json",
      "repo_url",
      "repo_key",
      "author",
      "commit_sha",
      "branch",
      "tool",
      "distinct_id",
      "author_identity",
      "credential_id",
      "received_at",
    ];
    const tokenUpdate = tokenColumns.slice(4).map((column) => `${column} = ?`).join(", ");
    return {
      selectHash: this.db.prepare("SELECT event_hash FROM metric_hashes WHERE event_hash = ?"),
      insertHash: this.db.prepare("INSERT INTO metric_hashes (event_hash, event_id) VALUES (?, ?)"),
      insertMetric: this.db.prepare(
        `INSERT INTO metric_events (
          event_hash, event_ts, event_id, raw_json,
          repo_url, repo_key, author, commit_sha, branch, tool, model, session_id,
          distinct_id, author_identity, credential_id, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      selectMetricsByCommit: this.db.prepare(
        `SELECT event_id, event_ts, raw_json, repo_url, author, commit_sha, branch, tool, model, session_id,
                distinct_id, author_identity, credential_id, repo_key, id
         FROM metric_events WHERE commit_sha = ? ORDER BY id`,
      ),
      selectToken: this.db.prepare(
        `SELECT emitted_seq FROM token_usage
         WHERE credential_id IS ? AND session_id = ? AND model = ? AND speed = ? AND bucket_ts = ?`,
      ),
      insertToken: this.db.prepare(
        `INSERT INTO token_usage (${tokenColumns.join(", ")}) VALUES (${placeholders(tokenColumns.length)})`,
      ),
      updateToken: this.db.prepare(
        `UPDATE token_usage SET ${tokenUpdate}
         WHERE credential_id IS ? AND session_id = ? AND model = ? AND speed = ? AND bucket_ts = ?`,
      ),
      selectTokenBucket: this.db.prepare(
        `SELECT session_id, model, speed, bucket_ts, emitted_seq,
                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cache_write_1h_tokens,
                reasoning_output_tokens, total_tokens,
                long_context_input_tokens, long_context_output_tokens, long_context_cache_read_tokens,
                long_context_cache_write_tokens, long_context_cache_write_1h_tokens,
                est_cost_micro_usd, transcript_cost_micro_usd, credits, message_count, speed_inferred,
                raw_json, repo_url, repo_key, author, commit_sha, branch, tool, distinct_id, author_identity, credential_id, id
         FROM token_usage WHERE session_id = ? AND model = ? AND speed = ? AND bucket_ts = ?`,
      ),
      selectCas: this.db.prepare("SELECT hash FROM cas_objects WHERE hash = ?"),
      insertCas: this.db.prepare(
        `INSERT INTO cas_objects (
          hash, content_json, metadata_json, raw_json, repo_url, repo_key, branch, distinct_id, author_identity, credential_id, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      upsertNote: this.db.prepare(
        `INSERT INTO notes (commit_sha, content, distinct_id, author_identity, credential_id, received_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(commit_sha) DO UPDATE SET
           content = excluded.content,
           distinct_id = excluded.distinct_id,
           author_identity = excluded.author_identity,
           credential_id = excluded.credential_id,
           received_at = excluded.received_at`,
      ),
      selectLogId: this.db.prepare("SELECT event_id FROM log_events WHERE event_id = ?"),
      insertLog: this.db.prepare(
        `INSERT INTO log_events (
          event_id, kind, logged_at, level, target, message, fields_json,
          repo_url, repo_key, git_ai_version, daemon_id, install_id, raw_json,
          distinct_id, author_identity, credential_id, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      insertBundle: this.db.prepare(
        `INSERT INTO bundles (id, title, body_json, distinct_id, author_identity, credential_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
      selectBundle: this.db.prepare(
        `SELECT id, body_json, distinct_id, author_identity, credential_id, created_at FROM bundles WHERE id = ?`,
      ),
    };
  }

  private withTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // The original error is the one callers need.
      }
      throw error;
    }
  }

  private exclusive<T>(fn: () => T, allowClosed = false): Promise<T> {
    const run = this.tail.then(() => {
      if (!allowClosed) this.assertOpen();
      return fn();
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("store is closed");
  }

  private metricFromRow(row: Record<string, unknown>): StoredMetricEvent {
    return {
      id: integerColumn(row, "id"),
      eventId: integerColumn(row, "event_id"),
      eventTs: integerColumn(row, "event_ts"),
      repoUrl: nullableText(row, "repo_url"),
      repoKey: nullableText(row, "repo_key"),
      credentialId: nullableText(row, "credential_id"),
      author: nullableText(row, "author"),
      commitSha: nullableText(row, "commit_sha"),
      branch: nullableText(row, "branch"),
      tool: nullableText(row, "tool"),
      model: nullableText(row, "model"),
      sessionId: nullableText(row, "session_id"),
      raw: JSON.parse(textColumn(row, "raw_json")) as unknown,
      distinctId: nullableText(row, "distinct_id"),
      authorIdentity: nullableText(row, "author_identity"),
    };
  }

  private tokenFromRow(row: Record<string, unknown>): TokenUsageRecord {
    return {
      id: integerColumn(row, "id"),
      sessionId: textColumn(row, "session_id"),
      model: textColumn(row, "model"),
      speed: integerColumn(row, "speed"),
      bucketTs: integerColumn(row, "bucket_ts"),
      emittedSeq: integerColumn(row, "emitted_seq"),
      inputTokens: nullableInteger(row, "input_tokens"),
      outputTokens: nullableInteger(row, "output_tokens"),
      cacheReadTokens: nullableInteger(row, "cache_read_tokens"),
      cacheWriteTokens: nullableInteger(row, "cache_write_tokens"),
      cacheWrite1hTokens: nullableInteger(row, "cache_write_1h_tokens"),
      reasoningOutputTokens: nullableInteger(row, "reasoning_output_tokens"),
      totalTokens: nullableInteger(row, "total_tokens"),
      longContextInputTokens: nullableInteger(row, "long_context_input_tokens"),
      longContextOutputTokens: nullableInteger(row, "long_context_output_tokens"),
      longContextCacheReadTokens: nullableInteger(row, "long_context_cache_read_tokens"),
      longContextCacheWriteTokens: nullableInteger(row, "long_context_cache_write_tokens"),
      longContextCacheWrite1hTokens: nullableInteger(row, "long_context_cache_write_1h_tokens"),
      estCostMicroUsd: nullableInteger(row, "est_cost_micro_usd"),
      transcriptCostMicroUsd: nullableInteger(row, "transcript_cost_micro_usd"),
      credits: nullableReal(row, "credits"),
      messageCount: nullableInteger(row, "message_count"),
      speedInferred: nullableInteger(row, "speed_inferred"),
      raw: JSON.parse(textColumn(row, "raw_json")) as unknown,
      repoUrl: nullableText(row, "repo_url"),
      repoKey: nullableText(row, "repo_key"),
      credentialId: nullableText(row, "credential_id"),
      author: nullableText(row, "author"),
      commitSha: nullableText(row, "commit_sha"),
      branch: nullableText(row, "branch"),
      tool: nullableText(row, "tool"),
      distinctId: nullableText(row, "distinct_id"),
      authorIdentity: nullableText(row, "author_identity"),
    };
  }
}

export function openCollectorStore(sqlitePath: string): CollectorStore {
  return new SqliteCollectorStore(sqlitePath);
}

function tokenRow(
  identity: RowIdentity,
  event: ParsedMetricEvent,
  token: ParsedTokenUsage,
  receivedAt: string,
): TokenRow {
  return {
    ...token,
    eventHash: event.hash,
    eventTs: event.eventTs,
    rawJson: JSON.stringify(event.raw),
    repoUrl: event.common.repoUrl,
    repoKey: repoKey(event.common.repoUrl),
    author: event.common.author,
    commitSha: event.common.commitSha,
    branch: event.common.branch,
    tool: event.common.tool,
    distinctId: identity.distinctId,
    authorIdentity: identity.authorIdentity,
    credentialId: identity.credentialId ?? null,
    receivedAt,
  };
}

function tokenValues(row: TokenRow): SQLInputValue[] {
  return [
    row.sessionId,
    row.model,
    row.speed,
    row.bucketTs,
    row.emittedSeq,
    row.inputTokens,
    row.outputTokens,
    row.cacheReadTokens,
    row.cacheWriteTokens,
    row.cacheWrite1hTokens,
    row.reasoningOutputTokens,
    row.totalTokens,
    row.longContextInputTokens,
    row.longContextOutputTokens,
    row.longContextCacheReadTokens,
    row.longContextCacheWriteTokens,
    row.longContextCacheWrite1hTokens,
    row.estCostMicroUsd,
    row.transcriptCostMicroUsd,
    row.credits,
    row.messageCount,
    row.speedInferred,
    row.eventHash,
    row.eventTs,
    row.rawJson,
    row.repoUrl,
    row.repoKey,
    row.author,
    row.commitSha,
    row.branch,
    row.tool,
    row.distinctId,
    row.authorIdentity,
    row.credentialId,
    row.receivedAt,
  ];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function scopeSql(scope: CredentialScope, column: string): { sql: string; values: SQLInputValue[] } {
  if (scope === "*") return { sql: "", values: [] };
  if (scope.length === 0) return { sql: " AND 1 = 0", values: [] };
  return { sql: ` AND ${column} IN (${placeholders(scope.length)})`, values: [...scope] };
}

function readWhere(
  scope: CredentialScope,
  filters: ReadFilters,
  columns: { eventTs?: string; eventId?: string; repoKey?: string; branch?: string; id?: string },
): { sql: string; values: SQLInputValue[] } {
  const conditions: string[] = ["1 = 1"];
  const values: SQLInputValue[] = [];
  const access = scopeSql(scope, "credential_id");
  if (access.sql.length > 0) conditions.push(access.sql.slice(5));
  values.push(...access.values);
  if (filters.credentialId !== undefined) {
    conditions.push("credential_id = ?");
    values.push(filters.credentialId);
  }
  if (filters.repoKey !== undefined && columns.repoKey !== undefined) {
    conditions.push(`${columns.repoKey} = ?`);
    values.push(filters.repoKey);
  }
  if (filters.branch !== undefined && columns.branch !== undefined) {
    conditions.push(`${columns.branch} = ?`);
    values.push(filters.branch);
  }
  if (filters.from !== undefined && columns.eventTs !== undefined) {
    conditions.push(`${columns.eventTs} >= ?`);
    values.push(filters.from);
  }
  if (filters.to !== undefined && columns.eventTs !== undefined) {
    conditions.push(`${columns.eventTs} <= ?`);
    values.push(filters.to);
  }
  if (filters.eventId !== undefined && columns.eventId !== undefined) {
    conditions.push(`${columns.eventId} = ?`);
    values.push(filters.eventId);
  }
  if (filters.afterId !== undefined) {
    conditions.push(`${columns.id ?? "id"} > ?`);
    values.push(filters.afterId);
  }
  return { sql: ` WHERE ${conditions.join(" AND ")}`, values };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected sqlite row");
  }
  return value as Record<string, unknown>;
}

function integerColumn(row: Record<string, unknown>, name: string): number {
  const value = row[name];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`expected integer column ${name}`);
}

function nullableInteger(row: Record<string, unknown>, name: string): number | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  return integerColumn(row, name);
}

function nullableReal(row: Record<string, unknown>, name: string): number | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  throw new Error(`expected real column ${name}`);
}

function textColumn(row: Record<string, unknown>, name: string): string {
  const value = nullableText(row, name);
  if (value === null) throw new Error(`expected text column ${name}`);
  return value;
}

function nullableText(row: Record<string, unknown>, name: string): string | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new Error(`expected text column ${name}`);
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") record[key] = item;
  }
  return record;
}

function nullableMetadata(metadata: Record<string, string>, name: string): string | null {
  const value = metadata[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

/** Normalize common SSH and HTTP Git remotes to `host/path` for filtering. */
export function repoKey(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null;
  let remote = value.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const ssh = /^(?:ssh:\/\/)?git@([^/:]+)[:/]([^/].*)$/i.exec(remote);
  if (ssh !== null) return `${ssh[1]!.toLowerCase()}/${ssh[2]!.replace(/^\/+/, "").toLowerCase()}`;
  try {
    const url = new URL(remote);
    return `${url.hostname.toLowerCase()}/${url.pathname.replace(/^\/+/, "").toLowerCase()}`;
  } catch {
    return remote.toLowerCase();
  }
}
