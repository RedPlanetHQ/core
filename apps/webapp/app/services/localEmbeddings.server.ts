/**
 * Local in-process embeddings via @huggingface/transformers (ONNX Runtime).
 *
 * Active when EMBEDDINGS_PROVIDER=local. The pipeline is warmed at server
 * startup (see utils/startup.ts) so the first request path is fast. First-run
 * downloads (~150–200MB for nomic-embed-text-v1.5 @ q8) are streamed to logs
 * so the user knows the boot is not stuck.
 *
 * Cache location: env.LOCAL_EMBEDDING_CACHE_DIR, falls back to <cwd>/data/models.
 */

import path from "node:path";
import { pipeline, env as hfEnv } from "@huggingface/transformers";
import { env } from "~/env.server";
import { logger } from "./logger.service";

type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline>>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Resolve the cache dir once (respecting env override) and pin the transformers
 * runtime to hub-only loading — we never want to accidentally load a stray
 * ./models folder next to the process cwd.
 */
function configureRuntimeOnce(): string {
  const cacheDir =
    env.LOCAL_EMBEDDING_CACHE_DIR ||
    path.resolve(process.cwd(), "data", "models");
  hfEnv.cacheDir = cacheDir;
  hfEnv.allowLocalModels = false;
  return cacheDir;
}

/**
 * Log download progress at most once per 10% per file. Without throttling the
 * ONNX runtime emits hundreds of progress events per weight file and floods
 * the boot logs.
 */
function makeProgressLogger(modelId: string) {
  const lastLoggedPct = new Map<string, number>();
  return (data: any) => {
    const status = data?.status;
    const file: string = data?.file || data?.name || "";

    if (status === "initiate") {
      logger.info(`[embed:local] fetching ${file} (${modelId})`);
      lastLoggedPct.set(file, -1);
      return;
    }

    if (status === "progress") {
      const pct = Math.floor(Number(data.progress ?? 0));
      const prev = lastLoggedPct.get(file) ?? -1;
      if (pct - prev >= 10) {
        const loadedMb = data.loaded
          ? (data.loaded / 1024 / 1024).toFixed(1)
          : "?";
        const totalMb = data.total
          ? (data.total / 1024 / 1024).toFixed(1)
          : "?";
        logger.info(
          `[embed:local] downloading ${file}: ${pct}% (${loadedMb}/${totalMb} MB)`,
        );
        lastLoggedPct.set(file, pct);
      }
      return;
    }

    if (status === "done") {
      logger.info(`[embed:local] fetched ${file}`);
      return;
    }

    if (status === "ready") {
      logger.info(`[embed:local] pipeline ready (${modelId})`);
    }
  };
}

/**
 * Load (and cache) the feature-extraction pipeline. Safe to call repeatedly —
 * subsequent calls await the same in-flight promise, so concurrent request
 * paths won't kick off duplicate downloads.
 */
export function initLocalEmbeddings(modelId?: string): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise) return pipelinePromise;

  const model = modelId || env.EMBEDDING_MODEL;
  const dtype = env.LOCAL_EMBEDDING_DTYPE;
  const cacheDir = configureRuntimeOnce();

  logger.info(
    `[embed:local] initializing pipeline (model=${model}, dtype=${dtype}, cache=${cacheDir})`,
  );

  pipelinePromise = pipeline("feature-extraction", model, {
    dtype: dtype as any,
    progress_callback: makeProgressLogger(model),
  }).catch((error) => {
    // Reset so a later call can retry (e.g. after fixing network/model id).
    pipelinePromise = null;
    logger.error(`[embed:local] pipeline load failed: ${error}`);
    throw error;
  }) as Promise<FeatureExtractionPipeline>;

  return pipelinePromise;
}

/**
 * Nomic v1.5 recommends task-specific prefixes ("search_document:" for
 * ingestion, "search_query:" for search). The current call sites don't
 * distinguish, and the model still works without prefixes — just slightly
 * worse recall. We prepend "search_document:" as the safer default since
 * ingestion is the dominant path; a future overload can accept a task.
 */
function prefixForNomic(modelId: string, text: string): string {
  if (modelId.toLowerCase().includes("nomic")) {
    return `search_document: ${text}`;
  }
  return text;
}

export async function embedLocal(text: string): Promise<number[]> {
  const extractor = await initLocalEmbeddings();
  const model = env.EMBEDDING_MODEL;
  const input = prefixForNomic(model, text);
  const output = await extractor(input, {
    pooling: "mean",
    normalize: true,
  } as any);
  // Tensor.data is a TypedArray; convert to plain number[] for downstream JSON storage
  return Array.from(output.data as Float32Array);
}

/** For tests / graceful shutdown. */
export function resetLocalEmbeddingsForTests(): void {
  pipelinePromise = null;
}
