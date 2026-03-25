import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { env } from "~/env.server";

let _mastra: Mastra | null = null;

export function getMastra(): Mastra {
  if (!_mastra) {
    _mastra = new Mastra({
      storage: new PostgresStore({
        id: "core",
        connectionString: env.DATABASE_URL,
      }),
    });
  }
  return _mastra;
}
