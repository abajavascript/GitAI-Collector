import type { Writable } from "node:stream";

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { authenticate } from "./auth.js";
import type { CollectorConfig } from "./config.js";
import { registerHealthRoute } from "./routes/health.js";
import { EMPTY_IDENTITY, type CollectorStore, type RowIdentity } from "./store/types.js";

const BODY_LIMIT_BYTES = 32 * 1024 * 1024;
const requestIdentity = Symbol("requestIdentity");
const SECRET_HEADER_PATHS = [
  "req.headers.authorization",
  "req.headers['x-api-key']",
  'req.headers["x-api-key"]',
];

interface IdentitySlot {
  [requestIdentity]?: RowIdentity;
}

declare module "fastify" {
  interface FastifyInstance {
    config: CollectorConfig;
    store: CollectorStore;
  }

  interface FastifyRequest {
    identity: RowIdentity;
  }
}

export interface BuildAppOptions {
  config: CollectorConfig;
  store: CollectorStore;
  logger?: boolean;
  logStream?: Writable;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    logger: loggerOptions(options),
  });

  app.decorate("config", options.config);
  app.decorate("store", options.store);
  app.decorateRequest("identity", {
    getter(): RowIdentity {
      return (this as FastifyRequest & IdentitySlot)[requestIdentity] ?? EMPTY_IDENTITY;
    },
    setter(value: RowIdentity): void {
      (this as FastifyRequest & IdentitySlot)[requestIdentity] = value;
    },
  });
  app.addHook("onRequest", async (request, reply) => {
    if (isHealthRequest(request)) {
      request.identity = EMPTY_IDENTITY;
      return;
    }

    const result = authenticate(request.headers, request.server.config);
    if (!result.ok) {
      request.identity = EMPTY_IDENTITY;
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    request.identity = result.identity;
  });
  registerHealthRoute(app);

  app.addHook("onClose", async () => {
    await options.store.close();
  });

  return app;
}

function loggerOptions(options: BuildAppOptions): boolean | { level: string; redact: string[]; stream?: Writable } {
  if (options.logger === false) return false;
  return {
    level: "info",
    redact: SECRET_HEADER_PATHS,
    ...(options.logStream === undefined ? {} : { stream: options.logStream }),
  };
}

function isHealthRequest(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const path = request.url.split("?", 1)[0] ?? request.url;
  return path === "/health" || path === "/health/";
}
