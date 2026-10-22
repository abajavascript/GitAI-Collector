import type { AccessResponse, MetricItem, NoteItem, Page, PromptItem, TokenUsageItem } from "./types";

export function isAccess(value: unknown): value is AccessResponse {
  if (!isObject(value) || typeof value.id !== "string" || value.id.length === 0) return false;
  if (value.read === "*") return true;
  return Array.isArray(value.read) && value.read.every((item) => typeof item === "string");
}

export function isMetricItem(value: unknown): value is MetricItem {
  if (!isObject(value)) return false;
  return typeof value.id === "number"
    && isNullableString(value.credential_id)
    && isNullableString(value.repo_url)
    && isNullableString(value.repo_key)
    && isNullableString(value.branch)
    && isNullableString(value.author)
    && isNullableString(value.commit_sha)
    && isNullableString(value.tool)
    && isNullableString(value.model)
    && isNullableString(value.session)
    && typeof value.timestamp === "number"
    && typeof value.event === "number";
}

export function isTokenUsageItem(value: unknown): value is TokenUsageItem {
  if (!isObject(value)) return false;
  return typeof value.id === "number"
    && isNullableString(value.credential_id)
    && isNullableString(value.repo_url)
    && isNullableString(value.repo_key)
    && isNullableString(value.branch)
    && isNullableString(value.author)
    && isNullableString(value.commit_sha)
    && isNullableString(value.tool)
    && isNullableString(value.session)
    && typeof value.model === "string"
    && typeof value.bucket_ts === "number"
    && isNullableNumber(value.input_tokens)
    && isNullableNumber(value.output_tokens)
    && isNullableNumber(value.total_tokens)
    && isNullableNumber(value.est_cost_micro_usd);
}

export function isPromptItem(value: unknown): value is PromptItem {
  if (!isObject(value)) return false;
  return typeof value.id === "number"
    && typeof value.hash === "string"
    && isNullableString(value.credential_id)
    && isNullableString(value.repo_url)
    && isNullableString(value.repo_key)
    && isNullableString(value.branch)
    && isStringRecord(value.metadata);
}

export function isNoteItem(value: unknown): value is NoteItem {
  if (!isObject(value)) return false;
  return typeof value.id === "number"
    && typeof value.commit_sha === "string"
    && typeof value.content === "string"
    && isNullableString(value.credential_id);
}

export function isPage<T>(value: unknown, isItem: (item: unknown) => item is T): value is Page<T> {
  if (!isObject(value) || !Array.isArray(value.items)) return false;
  if (value.cursor !== null && typeof value.cursor !== "number") return false;
  return value.items.every(isItem);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}
