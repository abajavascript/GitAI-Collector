/** JSON shapes of the read API. Field names stay snake_case, matching the HTTP contract. */

export interface AccessResponse {
  id: string;
  read: "*" | string[];
}

export interface Page<T> {
  items: T[];
  cursor: number | null;
}

export interface MetricItem {
  id: number;
  credential_id: string | null;
  repo_url: string | null;
  repo_key: string | null;
  branch: string | null;
  author: string | null;
  commit_sha: string | null;
  tool: string | null;
  model: string | null;
  session: string | null;
  timestamp: number;
  event: number;
  raw: unknown;
}

export interface TokenUsageItem {
  id: number;
  credential_id: string | null;
  repo_url: string | null;
  repo_key: string | null;
  branch: string | null;
  author: string | null;
  commit_sha: string | null;
  tool: string | null;
  session: string | null;
  model: string;
  bucket_ts: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  est_cost_micro_usd: number | null;
  raw: unknown;
}

export interface PromptItem {
  id: number;
  hash: string;
  content: unknown;
  metadata: Record<string, string>;
  credential_id: string | null;
  repo_url: string | null;
  repo_key: string | null;
  branch: string | null;
}

export interface NoteItem {
  id: number;
  commit_sha: string;
  content: string;
  credential_id: string | null;
}
