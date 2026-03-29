import { loadBundle } from "./bundle-loader.client";

export type ToolUIComponent = React.ComponentType<Record<string, never>>;

export interface IntegrationToolUI {
  supported_tools: string[];
  render: (
    toolName: string,
    input: Record<string, unknown>,
    result: unknown,
    context: { placement: "webapp" | "tui"; [key: string]: unknown },
    submitInput: (newInput: Record<string, unknown>) => void,
    onDecline: () => void,
  ) => Promise<ToolUIComponent>;
}

export interface IntegrationBundle {
  toolUI: IntegrationToolUI | undefined;
}

export async function loadIntegrationBundle(
  frontendUrl: string,
): Promise<IntegrationBundle> {
  const mod = await loadBundle(frontendUrl);
  return { toolUI: mod.toolUI as IntegrationToolUI | undefined };
}
