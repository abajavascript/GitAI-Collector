import type { Writable } from "node:stream";

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { authenticate } from "./auth.js";
import type { CollectorConfig, Credential } from "./config.js";
import { registerBundleRoutes } from "./routes/bundles.js";
import { registerCasRoutes } from "./routes/cas.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerLogRoutes } from "./routes/logs.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerNoteRoutes } from "./routes/notes.js";
import { registerReadApiRoutes } from "./routes/read-api.js";
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
    credential: Credential | null;
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
    routerOptions: { ignoreTrailingSlash: true },
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
  app.decorateRequest("credential", null);
  app.addHook("onRequest", async (request, reply) => {
    if (isHealthRequest(request)) {
      request.identity = EMPTY_IDENTITY;
      request.credential = null;
      return;
    }

    const result = authenticate(request.headers, request.server.config);
    if (!result.ok) {
      request.identity = EMPTY_IDENTITY;
      request.credential = null;
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    request.identity = result.identity;
    request.credential = result.credential;
    if (request.method !== "GET" && request.method !== "HEAD" && !result.credential.write) {
      await reply.code(403).send({ error: "write access denied" });
    }
  });
  registerHealthRoute(app);
  registerMetricsRoute(app);
  registerCasRoutes(app);
  registerNoteRoutes(app);
  registerLogRoutes(app);
  registerBundleRoutes(app);
  registerReadApiRoutes(app);

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
