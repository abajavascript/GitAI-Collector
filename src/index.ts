import { ConfigError, loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { openCollectorStore } from "./store/index.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : "failed to load config");
    process.exit(1);
  }

  let store;
  try {
    store = openCollectorStore(config.sqlitePath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "failed to open store");
    process.exit(1);
  }

  const app = buildApp({ config, store });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(
      {
        sqlitePath: config.sqlitePath,
        apiKeyCount: config.apiKeys.length,
        bearerTokenCount: config.bearerTokens.length,
        publicBaseUrl: config.publicBaseUrl,
      },
      "collector started",
    );
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

void main();
