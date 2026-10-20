import { hashJson } from "./hash.js";
import {
  ATTR,
  LOG_KINDS,
  LOG_LEVELS,
  METRIC_EVENT_ID,
  STANDARD_SPEED,
  TOKEN_VALUE,
} from "./positions.js";

export interface CommonAttrs {
  repoUrl: string | null;
  author: string | null;
  commitSha: string | null;
  branch: string | null;
  tool: string | null;
  model: string | null;
  sessionId: string | null;
}

export interface ParsedMetricEvent {
  eventTs: number;
  eventId: number;
  values: Record<string, unknown>;
  attrs: Record<string, unknown>;
  raw: unknown;
  hash: string;
  common: CommonAttrs;
}

export interface ParsedTokenUsage {
  sessionId: string;
  model: string;
  speed: number;
  bucketTs: number;
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
}

export interface ParsedLogEvent {
  eventId: string | null;
  kind: string;
  timestamp: string;
  level: string;
  target: string | null;
  message: string;
  fieldsJson: string;
  repoUrl: string | null;
  gitAiVersion: string | null;
  rawJson: string;
}

export function parseMetricEvent(
  raw: unknown,
): { ok: true; event: ParsedMetricEvent } | { ok: false; error: string } {
  const record = asRecord(raw);
  if (!record) return { ok: false, error: "metric event must be an object" };

  const eventTs = readRequiredInt(
    record,
    "t",
    "metric event is missing timestamp",
    "metric event timestamp must be an integer",
  );
  if (typeof eventTs !== "number") return eventTs;
  const eventId = readRequiredInt(
    record,
    "e",
    "metric event is missing event id",
    "metric event id must be an integer",
  );
  if (typeof eventId !== "number") return eventId;

  const values = readSparse(record, "v", "metric event is missing values");
  if (!values.ok) return values;
  const attrs = readSparse(record, "a", "metric event is missing attrs");
  if (!attrs.ok) return attrs;

  return {
    ok: true,
    event: {
      eventTs,
      eventId,
      values: values.map,
      attrs: attrs.map,
      raw,
      hash: hashJson(raw),
      common: {
        repoUrl: readAttr(attrs.map, ATTR.repoUrl),
        author: readAttr(attrs.map, ATTR.author),
        commitSha: readAttr(attrs.map, ATTR.commitSha),
        branch: readAttr(attrs.map, ATTR.branch),
        tool: readAttr(attrs.map, ATTR.tool),
        model: readAttr(attrs.map, ATTR.model),
        sessionId: readAttr(attrs.map, ATTR.sessionId),
      },
    },
  };
}

export function parseTokenUsage(
  event: ParsedMetricEvent,
): { ok: true; token: ParsedTokenUsage } | { ok: false; error: string } {
  if (event.eventId !== METRIC_EVENT_ID.tokenUsage) {
    return { ok: false, error: "not a token usage event" };
  }

  const sessionId = event.common.sessionId;
  if (!sessionId) return { ok: false, error: "token usage event is missing session_id" };

  const bucketTs = readRequiredSparseInt(event.values, TOKEN_VALUE.bucketTs, "bucket_ts");
  if (typeof bucketTs !== "number") return bucketTs;
  const emittedSeq = readRequiredSparseInt(event.values, TOKEN_VALUE.emittedSeq, "emitted_seq");
  if (typeof emittedSeq !== "number") return emittedSeq;

  const speed = readSpeed(event.values);
  if (typeof speed !== "number") return speed;
  const model = readModel(event.common.model, event.attrs);
  if (typeof model !== "string") return model;

  const inputTokens = readOptionalInt(event.values, TOKEN_VALUE.inputTokens, "input_tokens");
  if (!inputTokens.ok) return inputTokens;
  const outputTokens = readOptionalInt(event.values, TOKEN_VALUE.outputTokens, "output_tokens");
  if (!outputTokens.ok) return outputTokens;
  const cacheReadTokens = readOptionalInt(event.values, TOKEN_VALUE.cacheReadTokens, "cache_read_tokens");
  if (!cacheReadTokens.ok) return cacheReadTokens;
  const cacheWriteTokens = readOptionalInt(event.values, TOKEN_VALUE.cacheWriteTokens, "cache_write_tokens");
  if (!cacheWriteTokens.ok) return cacheWriteTokens;
  const cacheWrite1hTokens = readOptionalInt(
    event.values,
    TOKEN_VALUE.cacheWrite1hTokens,
    "cache_write_1h_tokens",
  );
  if (!cacheWrite1hTokens.ok) return cacheWrite1hTokens;
  const reasoningOutputTokens = readOptionalInt(
    event.values,
    TOKEN_VALUE.reasoningOutputTokens,
    "reasoning_output_tokens",
  );
  if (!reasoningOutputTokens.ok) return reasoningOutputTokens;
  const totalTokens = readOptionalInt(event.values, TOKEN_VALUE.totalTokens, "total_tokens");
  if (!totalTokens.ok) return totalTokens;
  const longContextInputTokens = readOptionalInt(
    event.values,
    TOKEN_VALUE.longContextInputTokens,
    "long_context_input_tokens",
  );
  if (!longContextInputTokens.ok) return longContextInputTokens;
  const longContextOutputTokens = readOptionalInt(
    event.values,
    TOKEN_VALUE.longContextOutputTokens,
    "long_context_output_tokens",
  );
  if (!longContextOutputTokens.ok) return longContextOutputTokens;
  const longContextCacheReadTokens = readOptionalInt(
    event.values,
    TOKEN_VALUE.longContextCacheReadTokens,
    "long_context_cache_read_tokens",
  );
  if (!longContextCacheReadTokens.ok) return longContextCacheReadTokens;
  const longContextCacheWriteTokens = readOptionalInt(
    event.values,
    TOKEN_VALUE.longContextCacheWriteTokens,
    "long_context_cache_write_tokens",
  );
  if (!longContextCacheWriteTokens.ok) return longContextCacheWriteTokens;
  const longContextCacheWrite1hTokens = readOptionalInt(
    event.values,
    TOKEN_VALUE.longContextCacheWrite1hTokens,
    "long_context_cache_write_1h_tokens",
  );
  if (!longContextCacheWrite1hTokens.ok) return longContextCacheWrite1hTokens;
  const estCostMicroUsd = readOptionalInt(event.values, TOKEN_VALUE.estCostMicroUsd, "est_cost_micro_usd");
  if (!estCostMicroUsd.ok) return estCostMicroUsd;
  const transcriptCostMicroUsd = readOptionalInt(
    event.values,
    TOKEN_VALUE.transcriptCostMicroUsd,
    "transcript_cost_micro_usd",
  );
  if (!transcriptCostMicroUsd.ok) return transcriptCostMicroUsd;
  const credits = readOptionalFinite(event.values, TOKEN_VALUE.credits, "credits");
  if (!credits.ok) return credits;
  const messageCount = readOptionalInt(event.values, TOKEN_VALUE.messageCount, "message_count");
  if (!messageCount.ok) return messageCount;
  const speedInferred = readOptionalInt(event.values, TOKEN_VALUE.speedInferred, "speed_inferred");
  if (!speedInferred.ok) return speedInferred;

  return {
    ok: true,
    token: {
      sessionId,
      model,
      speed,
      bucketTs,
      emittedSeq,
      inputTokens: inputTokens.value,
      outputTokens: outputTokens.value,
      cacheReadTokens: cacheReadTokens.value,
      cacheWriteTokens: cacheWriteTokens.value,
      cacheWrite1hTokens: cacheWrite1hTokens.value,
      reasoningOutputTokens: reasoningOutputTokens.value,
      totalTokens: totalTokens.value,
      longContextInputTokens: longContextInputTokens.value,
      longContextOutputTokens: longContextOutputTokens.value,
      longContextCacheReadTokens: longContextCacheReadTokens.value,
      longContextCacheWriteTokens: longContextCacheWriteTokens.value,
      longContextCacheWrite1hTokens: longContextCacheWrite1hTokens.value,
      estCostMicroUsd: estCostMicroUsd.value,
      transcriptCostMicroUsd: transcriptCostMicroUsd.value,
      credits: credits.value,
      messageCount: messageCount.value,
      speedInferred: speedInferred.value,
    },
  };
}

export function parseLogEvent(
  raw: unknown,
): { ok: true; event: ParsedLogEvent } | { ok: false; error: string } {
  const record = asRecord(raw);
  if (!record) return { ok: false, error: "log event must be an object" };

  const kind = record.kind;
  if (typeof kind !== "string" || !LOG_KINDS.includes(kind as (typeof LOG_KINDS)[number])) {
    return { ok: false, error: "unsupported log kind" };
  }
  const level = record.level;
  if (typeof level !== "string" || !LOG_LEVELS.includes(level as (typeof LOG_LEVELS)[number])) {
    return { ok: false, error: "unsupported log level" };
  }
  const timestamp = record.timestamp;
  if (typeof timestamp !== "string" || timestamp.length === 0) {
    return { ok: false, error: "log event is missing timestamp" };
  }

  const eventId = readOptionalId(record.id);
  if (typeof eventId !== "string" && eventId !== null) return eventId;

  const target = readOptionalString(record.target, "log target");
  if (typeof target !== "string" && target !== null) return target;
  const message = readMessage(record.message);
  if (typeof message !== "string") return message;
  const fields = readFields(record.fields);
  if (!fields.ok) return fields;
  const repoUrl = readOptionalString(record.repo_url, "log repo_url");
  if (typeof repoUrl !== "string" && repoUrl !== null) return repoUrl;
  const gitAiVersion = readOptionalString(record.git_ai_version, "log git_ai_version");
  if (typeof gitAiVersion !== "string" && gitAiVersion !== null) return gitAiVersion;

  return {
    ok: true,
    event: {
      eventId,
      kind,
      timestamp,
      level,
      target,
      message,
      fieldsJson: JSON.stringify(fields.value),
      repoUrl,
      gitAiVersion,
      rawJson: JSON.stringify(raw),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readRequiredInt(
  record: Record<string, unknown>,
  key: string,
  missing: string,
  invalid: string,
): number | { ok: false; error: string } {
  if (!Object.hasOwn(record, key) || record[key] === null) return { ok: false, error: missing };
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return { ok: false, error: invalid };
  }
  return value;
}

function readSparse(
  record: Record<string, unknown>,
  key: string,
  missing: string,
): { ok: true; map: Record<string, unknown> } | { ok: false; error: string } {
  if (!Object.hasOwn(record, key) || record[key] === null) return { ok: false, error: missing };
  const value = record[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: missing };
  }
  return { ok: true, map: value as Record<string, unknown> };
}

function readAttr(map: Record<string, unknown>, position: number): string | null {
  const value = map[String(position)];
  return typeof value === "string" ? value : null;
}

function readRequiredSparseInt(
  map: Record<string, unknown>,
  position: number,
  name: string,
): number | { ok: false; error: string } {
  const key = String(position);
  if (!Object.hasOwn(map, key) || map[key] === null) {
    return { ok: false, error: `token usage event is missing ${name}` };
  }
  const value = map[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return { ok: false, error: `token usage ${name} must be an integer` };
  }
  return value;
}

function readSpeed(
  map: Record<string, unknown>,
): number | { ok: false; error: string } {
  const key = String(TOKEN_VALUE.speed);
  if (!Object.hasOwn(map, key) || map[key] === null) return STANDARD_SPEED;
  const value = map[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return { ok: false, error: "token usage speed must be an integer" };
  }
  return value;
}

function readModel(
  model: string | null,
  attrs: Record<string, unknown>,
): string | { ok: false; error: string } {
  const key = String(ATTR.model);
  if (Object.hasOwn(attrs, key) && attrs[key] !== null && typeof attrs[key] !== "string") {
    return { ok: false, error: "token usage model must be a string" };
  }
  return model ?? "";
}

function readOptionalInt(
  map: Record<string, unknown>,
  position: number,
  name: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const key = String(position);
  if (!Object.hasOwn(map, key) || map[key] === null) return { ok: true, value: null };
  const value = map[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return { ok: false, error: `token usage ${name} must be an integer` };
  }
  return { ok: true, value };
}

function readOptionalFinite(
  map: Record<string, unknown>,
  position: number,
  name: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const key = String(position);
  if (!Object.hasOwn(map, key) || map[key] === null) return { ok: true, value: null };
  const value = map[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: `token usage ${name} must be a number` };
  }
  return { ok: true, value };
}

function readOptionalId(value: unknown): string | null | { ok: false; error: string } {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, error: "log event id must be a string" };
  }
  return value;
}

function readOptionalString(
  value: unknown,
  label: string,
): string | null | { ok: false; error: string } {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return { ok: false, error: `${label} must be a string` };
  return value;
}

function readMessage(value: unknown): string | { ok: false; error: string } {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return { ok: false, error: "log message must be a string" };
  return value;
}

function readFields(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "log fields must be an object" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}
