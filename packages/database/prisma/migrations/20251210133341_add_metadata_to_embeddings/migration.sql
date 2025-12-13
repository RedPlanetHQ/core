-- AlterTable
ALTER TABLE "compacted_session_embeddings" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "entity_embeddings" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "episode_embeddings" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "statement_embeddings" ADD COLUMN     "metadata" JSONB;
