import Fastify, { type FastifyInstance } from "fastify";

import type { CollectorConfig } from "./config.js";
import { registerHealthRoute } from "./routes/health.js";
import type { CollectorStore } from "./store/types.js";

const BODY_LIMIT_BYTES = 32 * 1024 * 1024;

declare module "fastify" {
  interface FastifyInstance {
    config: CollectorConfig;
    store: CollectorStore;
  }
}

export interface BuildAppOptions {
  config: CollectorConfig;
  store: CollectorStore;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    logger:
      options.logger === false
        ? false
        : {
            level: "info",
            redact: ["req.headers.authorization", "req.headers['x-api-key']"],
          },
  });

  app.decorate("config", options.config);
  app.decorate("store", options.store);
  registerHealthRoute(app);

  app.addHook("onClose", async () => {
    await options.store.close();
  });

  return app;
}
