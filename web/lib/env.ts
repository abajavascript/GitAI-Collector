import "server-only";
import { connection } from "next/server";

const PASSWORD = "DASHBOARD_PASSWORD";
const READ_KEY = "COLLECTOR_READ_KEY";
const BASE_URL = "COLLECTOR_BASE_URL";

export async function dashboardPassword(): Promise<string | undefined> {
  return readEnv(PASSWORD);
}

export async function collectorReadKey(): Promise<string | undefined> {
  return readEnv(READ_KEY);
}

export async function collectorBaseUrl(): Promise<string> {
  return (await readEnv(BASE_URL)) ?? "http://127.0.0.1:8080";
}

async function readEnv(name: string): Promise<string | undefined> {
  await connection();
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}
