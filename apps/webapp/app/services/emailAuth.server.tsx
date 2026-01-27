import { EmailLinkStrategy } from "@nichtsam/remix-auth-email-link";
import type { Authenticator } from "remix-auth";
import type { AuthUser } from "./authUser";
import { findOrCreateUser } from "~/models/user.server";
import { env } from "~/env.server";
import { sendMagicLinkEmail } from "~/services/email.server";
import { postAuthentication } from "./postAuth.server";
import { logger } from "./logger.service";

let secret = env.MAGIC_LINK_SECRET;
let APP_ORIGIN = env.APP_ORIGIN;
if (!secret) throw new Error("Missing MAGIC_LINK_SECRET env variable.");

const emailStrategy = new EmailLinkStrategy(
  {
    sendEmail: sendMagicLinkEmail,
    secret,
    magicEndpoint: `${APP_ORIGIN}/magic`,
    cookie: {
      name: "core:magiclink",
    },
  },
  async ({ email }: { email: string }) => {
    logger.info("Magic link user authenticated", { email });

    try {
      const { user, isNewUser } = await findOrCreateUser({
        email,
        authenticationMethod: "MAGIC_LINK",
      });

      const workspace = await postAuthentication({ user, isNewUser, loginMethod: "MAGIC_LINK" });

      return { userId: user.id, workspaceId: workspace?.id };
    } catch (error) {
      logger.debug("Magic link user failed to authenticate", {
        error: JSON.stringify(error),
      });
      throw error;
    }
  },
);

export function addEmailLinkStrategy(authenticator: Authenticator<AuthUser>) {
  authenticator.use(emailStrategy as any, "email-link");
}
