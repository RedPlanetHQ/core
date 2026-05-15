import { env } from "~/env.server";
import { registerGateway } from "./register.server";
import { logger } from "~/services/logger.service";

export async function maybeRegisterDefaultGateway({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const url = env.DEFAULT_GATEWAY_URL;
  const key = env.COREBRAIN_GATEWAY_SECURITY_KEY;
  if (!url || !key) return;

  try {
    const result = await registerGateway({
      baseUrl: url,
      securityKey: key,
      name: env.DEFAULT_GATEWAY_NAME,
      workspaceId,
      userId,
    });
    if (!result.ok) {
      logger.warn(
        `[default-gateway] auto-registration failed: ${result.error}`,
      );
    } else {
      logger.info(
        `[default-gateway] registered gateway ${result.gatewayId} for workspace ${workspaceId}`,
      );
    }
  } catch (err) {
    logger.warn(`[default-gateway] auto-registration threw: ${err}`);
  }
}
