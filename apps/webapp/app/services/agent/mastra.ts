import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { env } from "~/env.server";
import { singleton } from "~/utils/singleton";

export const mastra = singleton("mastra", getMastra);

export function getMastra(): Mastra {
  return new Mastra({
    storage: new PostgresStore({
      id: "core-id",
      connectionString: env.DATABASE_URL,
    }),
  });
}
