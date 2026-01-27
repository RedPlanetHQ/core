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
    const vite = await import("vite");
    viteDevServer = await vite.createServer({
      server: { middlewareMode: true },
    });
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
    // Enable CORS for all domains
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    const authenticationResult = await module.authenticateHybridRequest(
      req as any,
      {
        allowJWT: true,
      },
    );

    if (!authenticationResult) {
      // Step 1: Initial 401 handshake with WWW-Authenticate header
      res.setHeader(
        "WWW-Authenticate",
        `Bearer realm="mcp", resource_metadata="${process.env.APP_ORIGIN}/.well-known/oauth-protected-resource"`,
      );
      res.status(401).json({
        error: "unauthorized",
        error_description:
          "Authentication required. See WWW-Authenticate header for authorization information.",
      });
      return;
    }

    await module.handleSessionRequest(
      req,
      res,
      authenticationResult.workspaceId,
      authenticationResult.userId,
    );
  });

  app.post("/api/v1/mcp", async (req, res) => {
    // Enable CORS for all domains
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    const authenticationResult = await module.authenticateHybridRequest(
      req as any,
      {
        allowJWT: true,
      },
    );

    if (!authenticationResult) {
      // Step 1: Initial 401 handshake with WWW-Authenticate header
      res.setHeader(
        "WWW-Authenticate",
        `Bearer realm="mcp", resource_metadata="${process.env.APP_ORIGIN}/.well-known/oauth-protected-resource"`,
      );
      res.status(401).json({
        error: "unauthorized",
        error_description:
          "Authentication required. See WWW-Authenticate header for authorization information.",
      });
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
    // Enable CORS for all domains
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    const authenticationResult = await module.authenticateHybridRequest(
      req as any,
      {
        allowJWT: true,
      },
    );

    if (!authenticationResult) {
      // Step 1: Initial 401 handshake with WWW-Authenticate header
      res.setHeader(
        "WWW-Authenticate",
        `Bearer realm="mcp", resource_metadata="${process.env.APP_ORIGIN}/.well-known/oauth-protected-resource"`,
      );
      res.status(401).json({
        error: "unauthorized",
        error_description:
          "Authentication required. See WWW-Authenticate header for authorization information.",
      });
      return;
    }

    await module.handleSessionRequest(
      req,
      res,
      authenticationResult.workspaceId,
    );
  });

  app.options("/api/v1/mcp", (_, res) => {
    // Enable CORS for all domains
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.json({});
  });

  // Step 2: Protected Resource Metadata (PRM) endpoint
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    res.json({
      resource: `${process.env.APP_ORIGIN}/api/v1/mcp`,
      authorization_servers: [process.env.APP_ORIGIN],
      scopes_supported: [
        "mcp",
        "mcp:read",
        "mcp:write",
        "mcp.read",
        "mcp.write",
      ],
      bearer_methods_supported: ["header"],
      resource_signing_alg_values_supported: ["HS256"],
    });
  });

  // Step 3: Authorization Server Metadata endpoint
  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    res.json({
      issuer: process.env.APP_ORIGIN,
      authorization_endpoint: `${process.env.APP_ORIGIN}/oauth/authorize`,
      token_endpoint: `${process.env.APP_ORIGIN}/oauth/token`,
      registration_endpoint: `${process.env.APP_ORIGIN}/oauth/register`,
      scopes_supported: [
        "mcp",
        "mcp:read",
        "mcp:write",
        "mcp.read",
        "mcp.write",
      ],
      response_types_supported: ["code"],
      grant_types_supported: [
        "authorization_code",
        "refresh_token",
        "client_credentials",
      ],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
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
