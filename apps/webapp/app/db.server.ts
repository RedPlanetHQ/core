import { Prisma, PrismaClient } from "@core/database";
import invariant from "tiny-invariant";
import { z } from "zod";
import { env } from "./env.server";
import { isValidDatabaseUrl } from "./utils/db";
import { singleton } from "./utils/singleton";

export { Prisma };

export const prisma = singleton("prisma", getClient);

export const $replica = singleton(
  "replica",
  () => getReplicaClient() ?? prisma,
);

function getClient() {
  const { DATABASE_URL } = process.env;
  invariant(typeof DATABASE_URL === "string", "DATABASE_URL env var not set");

  const databaseUrl = extendQueryParams(DATABASE_URL, {
    connection_limit: env.DATABASE_CONNECTION_LIMIT.toString(),
    pool_timeout: env.DATABASE_POOL_TIMEOUT.toString(),
    connection_timeout: env.DATABASE_CONNECTION_TIMEOUT.toString(),
  });

  console.log(
    `🔌 setting up prisma client to ${redactUrlSecrets(databaseUrl)}`,
  );

  const client = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl.href,
      },
    },
    // @ts-expect-error
    log: [
      {
        emit: "stdout",
        level: "error",
      },
      {
        emit: "stdout",
        level: "info",
      },
      {
        emit: "stdout",
        level: "warn",
      },
    ].concat(
      process.env.VERBOSE_PRISMA_LOGS === "1"
        ? [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "query" },
          ]
        : [],
    ),
  });

  // connect eagerly
  client.$connect();

  console.log(`🔌 prisma client connected`);

  return client;
}

function getReplicaClient() {
  if (!env.DATABASE_READ_REPLICA_URL) {
    console.log(`🔌 No database replica, using the regular client`);
    return;
  }

  const replicaUrl = extendQueryParams(env.DATABASE_READ_REPLICA_URL, {
    connection_limit: env.DATABASE_CONNECTION_LIMIT.toString(),
    pool_timeout: env.DATABASE_POOL_TIMEOUT.toString(),
    connection_timeout: env.DATABASE_CONNECTION_TIMEOUT.toString(),
  });

  console.log(
    `🔌 setting up read replica connection to ${redactUrlSecrets(replicaUrl)}`,
  );

  const replicaClient = new PrismaClient({
    datasources: {
      db: {
        url: replicaUrl.href,
      },
    },
    // @ts-expect-error
    log: [
      {
        emit: "stdout",
        level: "error",
      },
      {
        emit: "stdout",
        level: "info",
      },
      {
        emit: "stdout",
        level: "warn",
      },
    ].concat(
      process.env.VERBOSE_PRISMA_LOGS === "1"
        ? [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "query" },
          ]
        : [],
    ),
  });

  // connect eagerly
  replicaClient.$connect();

  console.log(`🔌 read replica connected`);

  return replicaClient;
}

function extendQueryParams(
  hrefOrUrl: string | URL,
  queryParams: Record<string, string>,
) {
  const url = new URL(hrefOrUrl);
  const query = url.searchParams;

  for (const [key, val] of Object.entries(queryParams)) {
    query.set(key, val);
  }

  url.search = query.toString();

  return url;
}

function redactUrlSecrets(hrefOrUrl: string | URL) {
  const url = new URL(hrefOrUrl);
  url.password = "";
  return url.href;
}

export type { PrismaClient } from "@core/database";

export const PrismaErrorSchema = z.object({
  code: z.string(),
});

function getDatabaseSchema() {
  if (!isValidDatabaseUrl(env.DATABASE_URL)) {
    return "public";
  }

  const databaseUrl = new URL(env.DATABASE_URL);
  const schemaFromSearchParam = databaseUrl.searchParams.get("schema");

  if (!schemaFromSearchParam) {
    console.debug(
      "❗ database schema unspecified, will default to `public` schema",
    );
    return "public";
  }

  return schemaFromSearchParam;
}

export const DATABASE_SCHEMA = singleton("DATABASE_SCHEMA", getDatabaseSchema);

export const sqlDatabaseSchema = Prisma.sql([`${DATABASE_SCHEMA}`]);
