import type { FastifyInstance } from "fastify";

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/health", async () => {
    await app.store.ping();
    return { ok: true };
  });
}
