# AI SDK v5 Migration & Claude Agent Integration Guide

This document captures the work required to migrate our Remix webapp from **AI SDK 4.3.19** to **AI SDK 5.x** and to introduce the community **Claude Agent SDK provider** alongside the existing OpenAI integration. It assumes the reader is familiar with our codebase (`apps/webapp`) and with pnpm workspaces.

---

## 1. Upgrade Goals

1. Move the project to the AI SDK 5 stream while keeping feature parity with today’s flows (chat streaming, tool calls, embeddings, batch processing).
2. Maintain OpenAI as a first-class option and add Claude Agent (via `ai-sdk-provider-claude-code`) as an additional provider that can be selected by configuration.
3. Ensure deployment environments (Docker, Trigger tasks, etc.) keep working after the upgrade.

---

## 2. Dependency Plan

| Package | Current | Target for v5 | Notes |
| --- | --- | --- | --- |
| `ai` | 4.3.19 | 5.0.0 | Core SDK
| `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/amazon-bedrock` | 1.x / 2.2.x | ≥ 2.0.0 | Align all provider packages
| `@ai-sdk/provider` | (implicit) | 2.0.0 | New direct dependency once we import provider types
| `@ai-sdk/provider-utils` | (implicit) | 3.0.0 | Pulled by `ai`, but make explicit in lockfile
| `@ai-sdk/codemod` | new | latest | Used once during migration
| `ai-sdk-provider-claude-code` | new | 2.x | Claude Agent provider (requires AI SDK ≥ v5)
| `@anthropic-ai/claude-agent-sdk` | new | latest | Underlying SDK for claude-code provider
| `zod` | 3.25.76 | 3.25.76 or 4.1.8+ | v5 supports Zod 3 **or** 4. Upgrade to 4.1.8+ only if the rest of the codebase is compatible.

### Install commands (pnpm workspace)

```bash
# from repo root
pnpm up -C apps/webapp ai@5 @ai-sdk/openai@^2 @ai-sdk/anthropic@^2 \
  @ai-sdk/google@^2 @ai-sdk/amazon-bedrock@^2 @ai-sdk/provider@^2 \
  @ai-sdk/provider-utils@^3

pnpm add -C apps/webapp ai-sdk-provider-claude-code@^2 @anthropic-ai/claude-agent-sdk

# Optional (if upgrading Zod)
pnpm up -C apps/webapp zod@^4.1.8
```

> **Tip:** the codemod utility can be run without installing by using `pnpm dlx @ai-sdk/codemod v5 apps/webapp/app`.

---

## 3. Automated Codemods

AI SDK supplies codemods that rewrite many of the v4 → v5 breaking changes. Run them before touching code manually:

```bash
pnpm dlx @ai-sdk/codemod v5 apps/webapp/app
```

Key transforms they handle:

- `CoreMessage` → `ModelMessage`
- `Message` → `UIMessage`
- `maxTokens` → `maxOutputTokens`
- Token usage property renames (`promptTokens` → `inputTokens`, etc.)
- Stream part/event type renames

Expect to review each change; some constructs (custom tool wrappers, logging helpers) will still require hand edits.

---

## 4. Manual Code Updates

### 4.1 Type & Import Renames

| Change | Files |
| --- | --- |
| `CoreMessage` → `ModelMessage` | `apps/webapp/app/lib/model.server.ts`, `app/lib/batch/types.ts`, `app/trigger/**`, `app/services/**`, `app/services/search/rerank.ts`, `app/services/prompts/**`, `app/services/knowledgeGraph.server.ts` |
| `LanguageModelV1` annotations → `LanguageModel` (or drop the explicit type) | `app/lib/model.server.ts`, `app/trigger/chat/stream-utils.ts` |
| Update custom `TokenUsage` interface to use `inputTokens`, `outputTokens`, `totalTokens` | `app/lib/model.server.ts` |

> Leave `CoreMessage` aliases only if the codemod already rewired them; otherwise the compiler emits deprecation noise.

### 4.2 API Surface Changes

1. **max output tokens**
   - `maxTokens` → `maxOutputTokens` in `app/lib/model.server.ts`, `app/trigger/extension/search.ts`, `app/services/search/rerank.ts`.
2. **Stop conditions**
   - Replace `maxSteps` with `stopWhen: stepCountIs(n)` and import `stepCountIs` from `ai`. Update both `app/trigger/chat/stream-utils.ts` and `app/trigger/extension/search.ts`.
3. **Tool streaming flag**
   - Remove `toolCallStreaming: true` – streaming is always enabled now.
4. **Tool definition schema key**
   - `parameters` → `inputSchema` for every `tool({ ... })` definition. Affected files include `app/trigger/chat/chat-utils.ts`, `app/trigger/extension/search.ts`, `app/trigger/utils/types.ts`, and `app/trigger/utils/mcp.ts`.
5. **Tool call payload rename**
   - `toolCall.args` → `toolCall.input` and `toolResult.result` → `toolResult.output`. Adjust our representations in:
     - `app/trigger/chat/stream-utils.ts` (emitted events)
     - `app/trigger/chat/chat-utils.ts` (`toolToMessage`, live tool execution loop)
6. **Dynamic tool guard**
   - When iterating `toolCalls`, check `if (toolCall.dynamic) { … continue; }` before assuming a typed payload. (New requirement in v5.)
7. **Usage metrics**
   - Expect `event.usage` (per-step) and `event.totalUsage` (aggregate) in `streamText` callbacks.
   - Update all totals/logging to reference `usage.inputTokens`, `usage.outputTokens`, `usage.totalTokens`.
   - Files: `app/lib/model.server.ts`, `app/services/knowledgeGraph.server.ts`, `app/trigger/chat/chat-utils.ts`.
8. **onFinish callback shape**
   - `StreamTextOnFinishCallback` now receives a `StepResult & { steps: StepResult[]; totalUsage }`. Adjust the `onFinish` handler in `app/lib/model.server.ts` and `app/trigger/chat/stream-utils.ts` accordingly (access data via `event.text`, `event.totalUsage`).
9. **Stream protocol renames**
   - `fullStream` chunk types changed (`step-finish` → `finish-step`, `usage` → `totalUsage`). Update any switch statements accordingly (e.g., in Trigger code if we handle these chunk types manually).
10. **Token aggregations**
    - `TotalCost` structure in `chat-utils.ts` should track `inputTokens`, `outputTokens`, `totalTokens`; ensure addition uses the renamed keys.

### 4.3 Tool & Message Serialization

- `toolToMessage` should emit new property names (`input`, `output`).
- When we persist tool call history (e.g., `HistoryStep.skillInput`), store serialized input from `toolCall.input`.
- Update any code that expects legacy tool invocation typing to handle the new typed name `tool-${toolName}` in UI message parts if applicable.

### 4.4 Miscellaneous

- If we rely on `formatDataStreamPart`/`createDataStream` (not currently in use), migrate to `createUIMessageStream` helpers per the guide.
- If we ever import `ai/rsc`, move to `@ai-sdk/rsc`.

---

## 5. Integrating Claude Agent via `ai-sdk-provider-claude-code`

### 5.1 Provider Setup

1. **Install** the CLI once per host (outside pnpm):
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude login
   ```
2. Ensure the CLI binary (`claude`) is available inside every environment the webapp runs (Docker image, Trigger workers). If the binary lives outside `$PATH`, configure the provider with `pathToClaudeCodeExecutable`.
3. Add the dependency `ai-sdk-provider-claude-code@^2` to `apps/webapp` (done in the dependency step).

### 5.2 Code Changes

1. **Model selection**
   - Import the provider: `import { claudeCode } from 'ai-sdk-provider-claude-code';`
   - Extend `LLMModelEnum` / `LLMMappings` or introduce new constants for `claude-code-sonnet`, `claude-code-opus` to distinguish Agent SDK models from plain Anthropic API calls.
   - Update `getModelForTask` in `app/lib/model.server.ts` to return these identifiers and branch in the switch:
     ```ts
     case 'claude-code-sonnet':
       modelInstance = claudeCode('sonnet', claudeOptions);
       break;
     ```
     Provide `claudeOptions` from env (system prompt, settingSources, cwd, etc.) so behavior is predictable.

2. **Environment wiring**
   - Introduce env vars as needed (e.g., `CLAUDE_CLI_PATH`, `CLAUDE_SYSTEM_PROMPT`, `CLAUDE_SETTING_SOURCES`, `CLAUDE_STREAMING_INPUT_MODE`).
   - Extend validation in `app/env.server.ts` and `apps/webapp/app/utils/startup.ts#Keys`.
   - Surface new env vars in `hosting/docker/.env`, `docker-compose.yaml`, and `turbo.json#globalEnv` so Turbo/Trigger receive them.

3. **Batch flows**
   - `OpenAIBatchProvider` remains the only implemented provider. When `MODEL` contains `claude-code`, make `getProvider` in `app/lib/batch.server.ts` throw a descriptive error or route to a no-op provider to avoid silent failures.

4. **Tool usage**
   - The provider supports tool streaming, but some settings (e.g., `canUseTool`) require `streamingInput: 'always'`. Surface a configuration flag if we plan to allow runtime approval hooks.

5. **Observability**
   - The provider exposes `providerMetadata['claude-code']`; augment our logging if we want to capture CLI warnings/errors.

### 5.3 Deployment Considerations

- The Agent SDK spins up a local process per request; ensure container limits and filesystem permissions allow this (the CLI needs to write temp files, read project files, etc.).
- CLI authentication stores credentials under `~/.anthropic`. Mount or copy this into containers, or script `claude login --headless` in the image build.
- Streaming IO uses stdout/stderr; if our infrastructure captures standard output aggressively, confirm it doesn’t interfere.

---

## 6. Validation Checklist

1. **Type-check & lint**
   - `pnpm --filter webapp typecheck`
   - `pnpm --filter webapp lint`

2. **Runtime smoke tests**
   - Manual smoke test the chat UI with OpenAI and Claude.
   - Verify tool calls execute and tool results render (check tool part renames).

3. **Token accounting**
   - Confirm `usage` dashboards (billing summaries, history logs) still display values after the rename to `inputTokens`/`outputTokens`.

4. **Trigger tasks**
   - Run a Trigger.dev workflow that uses `stream-utils` to ensure the new stream event names propagate correctly.

5. **Docker compose**
   - Build and run `hosting/docker/docker-compose.yaml` to confirm the CLI is accessible and env wiring works end-to-end.

---

## 7. Risks & Follow-ups

- **Zod 4 adoption**: Upgrading Zod is optional but recommended by Vercel for TypeScript performance. Audit our validators first; some third-party packages may still expect Zod 3.
- **Batch jobs parity**: Claude Agent via CLI has no batch API. Keep OpenAI enabled for bulk processing or invest in a separate queue that falls back to OpenAI automatically.
- **Server resources**: Agent SDK processes are heavier than pure HTTP calls. Monitor CPU/RAM usage after rollout.
- **Tool schema enforcement**: Changing `parameters` to `inputSchema` is straightforward, but confirm every tool still returns the shape our downstream consumers expect.
- **CI/CD**: Ensure build containers and remote runners install the Claude CLI or skip Claude-specific tests when absent.

---

## 8. Suggested Rollout Sequence

1. Land dependency upgrades + codemod changes on a feature branch.
2. Address compiler errors and failing tests, then run through the manual checklist above.
3. Integrate the Claude provider with feature-flagged configuration (e.g., gated by `MODEL` value or dedicated toggle).
4. Validate in staging with both OpenAI and Claude.
5. Roll out to production, monitor logs for stream/tool parsing errors, and adjust logging thresholds if the CLI proves noisy.

---

## 9. Reference Material

- [AI SDK 5.0 Migration Guide](https://github.com/vercel/ai/blob/main/content/docs/08-migration-guides/26-migration-guide-5-0.mdx)
- [Community Claude Provider README](https://github.com/ben-vargas/ai-sdk-provider-claude-code)
- [`ai-sdk-provider-claude-code` v2 Docs](https://www.npmjs.com/package/ai-sdk-provider-claude-code)

Feel free to append implementation notes or decision outcomes to this file as the migration progresses.
