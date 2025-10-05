import { createRequestHandler } from "@remix-run/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";

// import { handleMCPRequest, handleSessionRequest } from "~/services/mcp.server";
// import { authenticateHybridRequest } from "~/services/routeBuilders/apiBuilder.server";

let viteDevServer: any;
let remixHandler;

async function init() {
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await import("vite");
      viteDevServer = await vite.createServer({
        server: { middlewareMode: true },
      });
    } catch (error) {
      const notFound = (error as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND";
      if (!notFound) {
        throw error;
      }

      console.warn(
        "Vite dev server unavailable; continuing with prebuilt Remix assets.",
      );
    }
  }

  const build: any = viteDevServer
    ? () => viteDevServer.ssrLoadModule("virtual:remix/server-build")
    : await import("./build/server/index.js");

  const module = viteDevServer
    ? (await build()).entry.module
    : build.entry?.module;

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

  app.get("/api/v1/mcp", async (req, res) => {
    const authenticationResult = await module.authenticateHybridRequest(
      req as any,
      {
        allowJWT: true,
      },
    );

    if (!authenticationResult) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    await module.handleSessionRequest(req, res, authenticationResult.userId);
  });

  app.post("/api/v1/mcp", async (req, res) => {
    const authenticationResult = await module.authenticateHybridRequest(
      req as any,
      {
        allowJWT: true,
      },
    );

    if (!authenticationResult) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const parsedBody = JSON.parse(body);
        const queryParams = req.query; // Get query parameters from the request
        await module.handleMCPRequest(
          req,
          res,
          parsedBody,
          authenticationResult,
          queryParams,
        );
      } catch (error) {
        res.status(400).json({ error: "Invalid JSON" });
      }
    });
  });

  app.delete("/api/v1/mcp", async (req, res) => {
    const authenticationResult = await module.authenticateHybridRequest(
      req as any,
      {
        allowJWT: true,
      },
    );

    if (!authenticationResult) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    await module.handleSessionRequest(req, res, authenticationResult.userId);
  });

  app.options("/api/v1/mcp", (_, res) => {
    res.json({});
  });

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
      code_challenge_methods_supported: ["S256", "plain"],
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
