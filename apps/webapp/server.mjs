import { createRequestHandler } from "@remix-run/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";

let viteDevServer;
let remixHandler;

async function init() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await import("vite");
    viteDevServer = await vite.createServer({
      server: { middlewareMode: true },
    });
  }

  const build = viteDevServer
    ? () => viteDevServer.ssrLoadModule("virtual:remix/server-build")
    : await import("./build/server/index.js");

  remixHandler = createRequestHandler({ build });

  const app = express();

  app.use(compression());

  // http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
  app.disable("x-powered-by");

  // handle asset requests
  if (viteDevServer) {
    app.use(viteDevServer.middlewares);
  } else {
    // Vite fingerprints its assets so we can cache forever.
    app.use(
      "/assets",
      express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
    );
  }

  // Everything else (like favicon.ico) is cached for an hour. You may want to be
  // more aggressive with this caching.
  app.use(express.static("build/client", { maxAge: "1h" }));

  app.use(morgan("tiny"));

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    res.json({
      issuer: process.env.APP_ORIGIN,
      authorization_endpoint: `${process.env.APP_ORIGIN}/oauth/authorize`,
      token_endpoint: `${process.env.APP_ORIGIN}/oauth/token`,
      registration_endpoint: `${process.env.APP_ORIGIN}/oauth/register`,
      scopes_supported: ["mcp"],
      response_types_supported: ["code"],
      grant_types_supported: [
        "authorization_code",
        "refresh_token",
        "client_credentials",
      ],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "none",
        "client_secret_post",
      ],
    });
  });

  // handle SSR requests
  app.all("*", remixHandler);

  const port = process.env.REMIX_APP_PORT || 3000;
  app.listen(port, () =>
    console.log(`Express server listening at http://localhost:${port}`),
  );
}

init().catch(console.error);
