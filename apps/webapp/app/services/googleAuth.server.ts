import type { Authenticator } from "remix-auth";
import { GoogleStrategy } from "@coji/remix-auth-google";
import { env } from "~/env.server";
import { findOrCreateUser } from "~/models/user.server";
import type { AuthUser } from "./authUser";
import { postAuthentication } from "./postAuth.server";
import { logger } from "./logger.service";

export function addGoogleStrategy(
  authenticator: Authenticator<AuthUser>,
  clientId: string,
  clientSecret: string,
) {
  const googleStrategy = new GoogleStrategy(
    {
      clientId,
      clientSecret,
      scopes: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/calendar",
      ],
      redirectURI: `${env.LOGIN_ORIGIN}/auth/google/callback`,
    },
    async ({ tokens }) => {
      const profile = await GoogleStrategy.userProfile(tokens);
      const emails = profile.emails;

      if (!emails) {
        throw new Error("Google login requires an email address");
      }

      try {
        logger.debug("Google login", {
          emails,
          profile,
        });

        const { user, isNewUser } = await findOrCreateUser({
          email: emails[0].value,
          authenticationMethod: "GOOGLE",
          authenticationProfile: profile,
          authenticationExtraParams: {},
        });

        await postAuthentication({
          user,
          isNewUser,
          loginMethod: "GOOGLE",
          tokens: {
            accessToken: tokens.accessToken(),
            refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
            expiresAt: tokens.accessTokenExpiresAt(),
            scopes: tokens.hasScopes() ? tokens.scopes() : [],
          },
          clientId,
          clientSecret,
        });

        return {
          userId: user.id,
        };
      } catch (error) {
        console.error(error);
        throw error;
      }
    },
  );

  authenticator.use(googleStrategy as any, "google");
}
