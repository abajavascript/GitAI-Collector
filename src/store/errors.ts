export class CollectorStoreError extends Error {
  override readonly name = "CollectorStoreError";
  readonly code = "invalid" as const;

  constructor(message: string) {
    super(message);
  }
}
