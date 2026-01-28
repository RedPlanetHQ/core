import { type z } from "zod";
import {
  type ApiAuthenticationResultSuccess,
  authenticateApiRequestWithFailure,
} from "../apiAuth.server";
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
} from "@remix-run/server-runtime";
import { fromZodError } from "zod-validation-error";
import { apiCors } from "~/utils/apiCors";
import {
  type AuthorizationAction,
  type AuthorizationResources,
  checkAuthorization,
} from "../authorization.server";
import { logger } from "../logger.service";
import { getUserSession } from "../session.server";

import { safeJsonParse } from "~/utils/json";

type AnyZodSchema =
  | z.ZodFirstPartySchemaTypes
  | z.ZodDiscriminatedUnion<any, any>;

type ApiKeyRouteBuilderOptions<
  TParamsSchema extends AnyZodSchema | undefined = undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined = undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TResource = never,
> = {
  params?: TParamsSchema;
  searchParams?: TSearchParamsSchema;
  headers?: THeadersSchema;
  allowJWT?: boolean;
  corsStrategy?: "all" | "none";
  findResource: (
    params: TParamsSchema extends
      | z.ZodFirstPartySchemaTypes
      | z.ZodDiscriminatedUnion<any, any>
      ? z.infer<TParamsSchema>
      : undefined,
    authentication: ApiAuthenticationResultSuccess,
    searchParams: TSearchParamsSchema extends
      | z.ZodFirstPartySchemaTypes
      | z.ZodDiscriminatedUnion<any, any>
      ? z.infer<TSearchParamsSchema>
      : undefined,
  ) => Promise<TResource | undefined>;
  shouldRetryNotFound?: boolean;
  authorization?: {
    action: AuthorizationAction;
    resource: (
      resource: NonNullable<TResource>,
      params: TParamsSchema extends
        | z.ZodFirstPartySchemaTypes
        | z.ZodDiscriminatedUnion<any, any>
        ? z.infer<TParamsSchema>
        : undefined,
      searchParams: TSearchParamsSchema extends
        | z.ZodFirstPartySchemaTypes
        | z.ZodDiscriminatedUnion<any, any>
        ? z.infer<TSearchParamsSchema>
        : undefined,
      headers: THeadersSchema extends
        | z.ZodFirstPartySchemaTypes
        | z.ZodDiscriminatedUnion<any, any>
        ? z.infer<THeadersSchema>
        : undefined,
    ) => AuthorizationResources;
    superScopes?: string[];
  };
};

type ApiKeyHandlerFunction<
  TParamsSchema extends AnyZodSchema | undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TResource = never,
> = (args: {
  params: TParamsSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TParamsSchema>
    : undefined;
  searchParams: TSearchParamsSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TSearchParamsSchema>
    : undefined;
  headers: THeadersSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<THeadersSchema>
    : undefined;
  authentication: ApiAuthenticationResultSuccess;
  request: Request;
  resource: NonNullable<TResource>;
}) => Promise<Response>;

export function createLoaderApiRoute<
  TParamsSchema extends AnyZodSchema | undefined = undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined = undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TResource = never,
>(
  options: ApiKeyRouteBuilderOptions<
    TParamsSchema,
    TSearchParamsSchema,
    THeadersSchema,
    TResource
  >,
  handler: ApiKeyHandlerFunction<
    TParamsSchema,
    TSearchParamsSchema,
    THeadersSchema,
    TResource
  >,
) {
  return async function loader({ request, params }: LoaderFunctionArgs) {
    const {
      params: paramsSchema,
      searchParams: searchParamsSchema,
      headers: headersSchema,
      allowJWT = false,
      corsStrategy = "none",
      authorization,
      findResource,
      shouldRetryNotFound,
    } = options;

    if (corsStrategy !== "none" && request.method.toUpperCase() === "OPTIONS") {
      return apiCors(request, json({}));
    }

    try {
      const authenticationResult = await authenticateApiRequestWithFailure(
        request,
        { allowJWT },
      );

      if (!authenticationResult) {
        return await wrapResponse(
          request,
          json({ error: "Invalid or Missing API key" }, { status: 401 }),
          corsStrategy !== "none",
        );
      }

      if (!authenticationResult.ok) {
        return await wrapResponse(
          request,
          json({ error: authenticationResult.error }, { status: 401 }),
          corsStrategy !== "none",
        );
      }

      let parsedParams: any = undefined;
      if (paramsSchema) {
        const parsed = paramsSchema.safeParse(params);
        if (!parsed.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Params Error",
                details: fromZodError(parsed.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedParams = parsed.data;
      }

      let parsedSearchParams: any = undefined;
      if (searchParamsSchema) {
        const searchParams = Object.fromEntries(
          new URL(request.url).searchParams,
        );
        const parsed = searchParamsSchema.safeParse(searchParams);
        if (!parsed.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Query Error",
                details: fromZodError(parsed.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedSearchParams = parsed.data;
      }

      let parsedHeaders: any = undefined;
      if (headersSchema) {
        const rawHeaders = Object.fromEntries(request.headers);
        const headers = headersSchema.safeParse(rawHeaders);
        if (!headers.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Headers Error",
                details: fromZodError(headers.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedHeaders = headers.data;
      }

      // Find the resource
      const resource = await findResource(
        parsedParams,
        authenticationResult,
        parsedSearchParams,
      );

      if (!resource) {
        return await wrapResponse(
          request,
          json(
            { error: "Not found" },
            {
              status: 404,
              headers: {
                "x-should-retry": shouldRetryNotFound ? "true" : "false",
              },
            },
          ),
          corsStrategy !== "none",
        );
      }

      if (authorization) {
        const { action, resource: authResource, superScopes } = authorization;
        const $authResource = authResource(
          resource,
          parsedParams,
          parsedSearchParams,
          parsedHeaders,
        );

        logger.debug("Checking authorization", {
          action,
          resource: $authResource,
          superScopes,
          scopes: authenticationResult.scopes,
        });

        const authorizationResult = checkAuthorization(authenticationResult);

        if (!authorizationResult.authorized) {
          return await wrapResponse(
            request,
            json(
              {
                error: `Unauthorized: ${authorizationResult.reason}`,
                code: "unauthorized",
                param: "access_token",
                type: "authorization",
              },
              { status: 403 },
            ),
            corsStrategy !== "none",
          );
        }
      }

      const result = await handler({
        params: parsedParams,
        searchParams: parsedSearchParams,
        headers: parsedHeaders,
        authentication: authenticationResult,
        request,
        resource,
      });
      return await wrapResponse(request, result, corsStrategy !== "none");
    } catch (error) {
      try {
        if (error instanceof Response) {
          return await wrapResponse(request, error, corsStrategy !== "none");
        }

        logger.error("Error in loader", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : String(error),
          url: request.url,
        });

        return await wrapResponse(
          request,
          json({ error: "Internal Server Error" }, { status: 500 }),
          corsStrategy !== "none",
        );
      } catch (innerError) {
        logger.error("[apiBuilder] Failed to handle error", {
          error,
          innerError,
        });

        return json({ error: "Internal Server Error" }, { status: 500 });
      }
    }
  };
}

type ApiKeyActionRouteBuilderOptions<
  TParamsSchema extends AnyZodSchema | undefined = undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined = undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TBodySchema extends AnyZodSchema | undefined = undefined,
> = {
  params?: TParamsSchema;
  searchParams?: TSearchParamsSchema;
  headers?: THeadersSchema;
  allowJWT?: boolean;
  corsStrategy?: "all" | "none";
  method?: "POST" | "PUT" | "DELETE" | "PATCH";
  authorization?: {
    action: AuthorizationAction;
  };
  maxContentLength?: number;
  body?: TBodySchema;
};

type ApiKeyActionHandlerFunction<
  TParamsSchema extends AnyZodSchema | undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TBodySchema extends AnyZodSchema | undefined = undefined,
> = (args: {
  params: TParamsSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TParamsSchema>
    : undefined;
  searchParams: TSearchParamsSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TSearchParamsSchema>
    : undefined;
  headers: THeadersSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<THeadersSchema>
    : undefined;
  body: TBodySchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TBodySchema>
    : undefined;
  authentication: ApiAuthenticationResultSuccess;
  request: Request;
}) => Promise<Response>;

export function createActionApiRoute<
  TParamsSchema extends AnyZodSchema | undefined = undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined = undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TBodySchema extends AnyZodSchema | undefined = undefined,
>(
  options: ApiKeyActionRouteBuilderOptions<
    TParamsSchema,
    TSearchParamsSchema,
    THeadersSchema,
    TBodySchema
  >,
  handler: ApiKeyActionHandlerFunction<
    TParamsSchema,
    TSearchParamsSchema,
    THeadersSchema,
    TBodySchema
  >,
) {
  const {
    params: paramsSchema,
    searchParams: searchParamsSchema,
    headers: headersSchema,
    body: bodySchema,
    allowJWT = false,
    corsStrategy = "none",
    authorization,
    maxContentLength,
  } = options;

  async function loader({ request, params }: LoaderFunctionArgs) {
    if (corsStrategy !== "none" && request.method.toUpperCase() === "OPTIONS") {
      return apiCors(request, json({}));
    }

    return new Response(null, { status: 405 });
  }

  async function action({ request, params }: ActionFunctionArgs) {
    if (options.method) {
      if (request.method.toUpperCase() !== options.method) {
        return await wrapResponse(
          request,
          json(
            { error: "Method not allowed" },
            { status: 405, headers: { Allow: options.method } },
          ),
          corsStrategy !== "none",
        );
      }
    }

    try {
      const authenticationResult = await authenticateApiRequestWithFailure(
        request,
        { allowJWT },
      );

      if (!authenticationResult) {
        return await wrapResponse(
          request,
          json({ error: "Invalid or Missing API key" }, { status: 401 }),
          corsStrategy !== "none",
        );
      }

      if (!authenticationResult.ok) {
        return await wrapResponse(
          request,
          json({ error: authenticationResult.error }, { status: 401 }),
          corsStrategy !== "none",
        );
      }

      if (maxContentLength) {
        const contentLength = request.headers.get("content-length");

        if (!contentLength || parseInt(contentLength) > maxContentLength) {
          return json({ error: "Request body too large" }, { status: 413 });
        }
      }

      let parsedParams: any = undefined;
      if (paramsSchema) {
        const parsed = paramsSchema.safeParse(params);
        if (!parsed.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Params Error",
                details: fromZodError(parsed.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedParams = parsed.data;
      }

      let parsedSearchParams: any = undefined;
      if (searchParamsSchema) {
        const searchParams = Object.fromEntries(
          new URL(request.url).searchParams,
        );
        const parsed = searchParamsSchema.safeParse(searchParams);
        if (!parsed.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Query Error",
                details: fromZodError(parsed.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedSearchParams = parsed.data;
      }

      let parsedHeaders: any = undefined;
      if (headersSchema) {
        const rawHeaders = Object.fromEntries(request.headers);
        const headers = headersSchema.safeParse(rawHeaders);
        if (!headers.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Headers Error",
                details: fromZodError(headers.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedHeaders = headers.data;
      }

      let parsedBody: any = undefined;
      if (bodySchema) {
        const rawBody = await request.text();
        if (rawBody.length === 0) {
          return await wrapResponse(
            request,
            json({ error: "Request body is empty" }, { status: 400 }),
            corsStrategy !== "none",
          );
        }

        const rawParsedJson = safeJsonParse(rawBody);

        if (!rawParsedJson) {
          return await wrapResponse(
            request,
            json({ error: "Invalid JSON" }, { status: 400 }),
            corsStrategy !== "none",
          );
        }

        const body = bodySchema.safeParse(rawParsedJson);
        if (!body.success) {
          return await wrapResponse(
            request,
            json(
              { error: fromZodError(body.error).toString() },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedBody = body.data;
      }

      if (authorization) {
        const { action } = authorization;

        logger.debug("Checking authorization", {
          action,
          scopes: authenticationResult.scopes,
        });

        const authorizationResult = checkAuthorization(authenticationResult);

        if (!authorizationResult.authorized) {
          return await wrapResponse(
            request,
            json(
              {
                error: `Unauthorized: ${authorizationResult.reason}`,
                code: "unauthorized",
                param: "access_token",
                type: "authorization",
              },
              { status: 403 },
            ),
            corsStrategy !== "none",
          );
        }
      }

      const result = await handler({
        params: parsedParams,
        searchParams: parsedSearchParams,
        headers: parsedHeaders,
        body: parsedBody,
        authentication: authenticationResult,
        request,
      });
      return await wrapResponse(request, result, corsStrategy !== "none");
    } catch (error) {
      try {
        if (error instanceof Response) {
          return await wrapResponse(request, error, corsStrategy !== "none");
        }

        logger.error("Error in action", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : String(error),
          url: request.url,
        });

        return await wrapResponse(
          request,
          json({ error: "Internal Server Error" }, { status: 500 }),
          corsStrategy !== "none",
        );
      } catch (innerError) {
        logger.error("[apiBuilder] Failed to handle error", {
          error,
          innerError,
        });

        return json({ error: "Internal Server Error" }, { status: 500 });
      }
    }
  }

  return { loader, action };
}

async function wrapResponse(
  request: Request,
  response: Response,
  useCors: boolean,
): Promise<Response> {
  // Prevent double CORS headers by checking if already present
  if (useCors && !response.headers.has("access-control-allow-origin")) {
    return await apiCors(request, response, {
      exposedHeaders: ["x-sol-jwt", "x-sol-jwt-claims"],
    });
  }

  return response;
}

// New hybrid authentication types and functions
export type HybridAuthenticationResult =
  | ApiAuthenticationResultSuccess
  | {
      ok: true;
      type: "COOKIE";
      userId: string;
      workspaceId?: string;
    };

export async function authenticateHybridRequest(
  request: Request,
  options: { allowJWT?: boolean } = {},
): Promise<HybridAuthenticationResult | null> {
  // First try API key authentication
  const apiResult = await authenticateApiRequestWithFailure(request, options);
  if (apiResult.ok) {
    return apiResult;
  }

  // If API key fails, try cookie authentication
  const userSession = await getUserSession(request);
  if (userSession) {
    return {
      ok: true,
      type: "COOKIE",
      userId: userSession.userId,
      workspaceId: userSession.workspaceId,
    };
  }

  return null;
}

type HybridActionRouteBuilderOptions<
  TParamsSchema extends AnyZodSchema | undefined = undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined = undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TBodySchema extends AnyZodSchema | undefined = undefined,
> = {
  params?: TParamsSchema;
  searchParams?: TSearchParamsSchema;
  headers?: THeadersSchema;
  allowJWT?: boolean;
  corsStrategy?: "all" | "none";
  method?: "POST" | "PUT" | "DELETE" | "PATCH";
  authorization?: {
    action: AuthorizationAction;
  };
  maxContentLength?: number;
  body?: TBodySchema;
};

type HybridActionHandlerFunction<
  TParamsSchema extends AnyZodSchema | undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TBodySchema extends AnyZodSchema | undefined = undefined,
> = (args: {
  params: TParamsSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TParamsSchema>
    : undefined;
  searchParams: TSearchParamsSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TSearchParamsSchema>
    : undefined;
  headers: THeadersSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<THeadersSchema>
    : undefined;
  body: TBodySchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TBodySchema>
    : undefined;
  authentication: HybridAuthenticationResult;
  request: Request;
}) => Promise<Response>;

export function createHybridActionApiRoute<
  TParamsSchema extends AnyZodSchema | undefined = undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined = undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TBodySchema extends AnyZodSchema | undefined = undefined,
>(
  options: HybridActionRouteBuilderOptions<
    TParamsSchema,
    TSearchParamsSchema,
    THeadersSchema,
    TBodySchema
  >,
  handler: HybridActionHandlerFunction<
    TParamsSchema,
    TSearchParamsSchema,
    THeadersSchema,
    TBodySchema
  >,
) {
  const {
    params: paramsSchema,
    searchParams: searchParamsSchema,
    headers: headersSchema,
    body: bodySchema,
    allowJWT = false,
    corsStrategy = "none",
    authorization,
    maxContentLength,
  } = options;

  async function loader({ request, params }: LoaderFunctionArgs) {
    if (corsStrategy !== "none" && request.method.toUpperCase() === "OPTIONS") {
      return apiCors(request, json({ origin: "*" }));
    }

    return new Response(null, { status: 405 });
  }

  async function action({ request, params }: ActionFunctionArgs) {
    if (options.method) {
      if (request.method.toUpperCase() !== options.method) {
        return await wrapResponse(
          request,
          json(
            { error: "Method not allowed" },
            { status: 405, headers: { Allow: options.method } },
          ),
          corsStrategy !== "none",
        );
      }
    }

    try {
      const authenticationResult = await authenticateHybridRequest(request, {
        allowJWT,
      });

      if (!authenticationResult) {
        return await wrapResponse(
          request,
          json({ error: "Authentication required" }, { status: 401 }),
          corsStrategy !== "none",
        );
      }

      if (maxContentLength) {
        const contentLength = request.headers.get("content-length");

        if (!contentLength || parseInt(contentLength) > maxContentLength) {
          return json({ error: "Request body too large" }, { status: 413 });
        }
      }

      let parsedParams: any = undefined;
      if (paramsSchema) {
        const parsed = paramsSchema.safeParse(params);
        if (!parsed.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Params Error",
                details: fromZodError(parsed.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedParams = parsed.data;
      }

      let parsedSearchParams: any = undefined;
      if (searchParamsSchema) {
        const searchParams = Object.fromEntries(
          new URL(request.url).searchParams,
        );
        const parsed = searchParamsSchema.safeParse(searchParams);
        if (!parsed.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Query Error",
                details: fromZodError(parsed.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedSearchParams = parsed.data;
      }

      let parsedHeaders: any = undefined;
      if (headersSchema) {
        const rawHeaders = Object.fromEntries(request.headers);
        const headers = headersSchema.safeParse(rawHeaders);
        if (!headers.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Headers Error",
                details: fromZodError(headers.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedHeaders = headers.data;
      }

      let parsedBody: any = undefined;
      if (bodySchema) {
        const rawBody = await request.text();
        if (rawBody.length === 0) {
          return await wrapResponse(
            request,
            json({ error: "Request body is empty" }, { status: 400 }),
            corsStrategy !== "none",
          );
        }

        const rawParsedJson = safeJsonParse(rawBody);

        if (!rawParsedJson) {
          return await wrapResponse(
            request,
            json({ error: "Invalid JSON" }, { status: 400 }),
            corsStrategy !== "none",
          );
        }

        const body = bodySchema.safeParse(rawParsedJson);
        if (!body.success) {
          return await wrapResponse(
            request,
            json(
              { error: fromZodError(body.error).toString() },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedBody = body.data;
      }

      // Authorization check - only applies to API key authentication
      if (authorization && authenticationResult.type === "PRIVATE") {
        const { action } = authorization;

        logger.debug("Checking authorization", {
          action,
          scopes: authenticationResult.scopes,
        });

        const authorizationResult = checkAuthorization(authenticationResult);

        if (!authorizationResult.authorized) {
          return await wrapResponse(
            request,
            json(
              {
                error: `Unauthorized: ${authorizationResult.reason}`,
                code: "unauthorized",
                param: "access_token",
                type: "authorization",
              },
              { status: 403 },
            ),
            corsStrategy !== "none",
          );
        }
      }

      const result = await handler({
        params: parsedParams,
        searchParams: parsedSearchParams,
        headers: parsedHeaders,
        body: parsedBody,
        authentication: authenticationResult,
        request,
      });
      return await wrapResponse(request, result, corsStrategy !== "none");
    } catch (error) {
      try {
        if (error instanceof Response) {
          return await wrapResponse(request, error, corsStrategy !== "none");
        }

        logger.error("Error in hybrid action", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : String(error),
          url: request.url,
        });

        return await wrapResponse(
          request,
          json({ error: "Internal Server Error" }, { status: 500 }),
          corsStrategy !== "none",
        );
      } catch (innerError) {
        logger.error("[apiBuilder] Failed to handle error", {
          error,
          innerError,
        });

        return json({ error: "Internal Server Error" }, { status: 500 });
      }
    }
  }

  return { loader, action };
}

// Hybrid Loader API Route types and builder
type HybridLoaderRouteBuilderOptions<
  TParamsSchema extends AnyZodSchema | undefined = undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined = undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TResource = never,
> = {
  params?: TParamsSchema;
  searchParams?: TSearchParamsSchema;
  headers?: THeadersSchema;
  allowJWT?: boolean;
  corsStrategy?: "all" | "none";
  findResource: (
    params: TParamsSchema extends
      | z.ZodFirstPartySchemaTypes
      | z.ZodDiscriminatedUnion<any, any>
      ? z.infer<TParamsSchema>
      : undefined,
    authentication: HybridAuthenticationResult,
    searchParams: TSearchParamsSchema extends
      | z.ZodFirstPartySchemaTypes
      | z.ZodDiscriminatedUnion<any, any>
      ? z.infer<TSearchParamsSchema>
      : undefined,
  ) => Promise<TResource | undefined>;
  shouldRetryNotFound?: boolean;
  authorization?: {
    action: AuthorizationAction;
    resource: (
      resource: NonNullable<TResource>,
      params: TParamsSchema extends
        | z.ZodFirstPartySchemaTypes
        | z.ZodDiscriminatedUnion<any, any>
        ? z.infer<TParamsSchema>
        : undefined,
      searchParams: TSearchParamsSchema extends
        | z.ZodFirstPartySchemaTypes
        | z.ZodDiscriminatedUnion<any, any>
        ? z.infer<TSearchParamsSchema>
        : undefined,
      headers: THeadersSchema extends
        | z.ZodFirstPartySchemaTypes
        | z.ZodDiscriminatedUnion<any, any>
        ? z.infer<THeadersSchema>
        : undefined,
    ) => AuthorizationResources;
    superScopes?: string[];
  };
};

type HybridLoaderHandlerFunction<
  TParamsSchema extends AnyZodSchema | undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TResource = never,
> = (args: {
  params: TParamsSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TParamsSchema>
    : undefined;
  searchParams: TSearchParamsSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<TSearchParamsSchema>
    : undefined;
  headers: THeadersSchema extends
    | z.ZodFirstPartySchemaTypes
    | z.ZodDiscriminatedUnion<any, any>
    ? z.infer<THeadersSchema>
    : undefined;
  authentication: HybridAuthenticationResult;
  request: Request;
  resource: NonNullable<TResource>;
}) => Promise<Response>;

export function createHybridLoaderApiRoute<
  TParamsSchema extends AnyZodSchema | undefined = undefined,
  TSearchParamsSchema extends AnyZodSchema | undefined = undefined,
  THeadersSchema extends AnyZodSchema | undefined = undefined,
  TResource = never,
>(
  options: HybridLoaderRouteBuilderOptions<
    TParamsSchema,
    TSearchParamsSchema,
    THeadersSchema,
    TResource
  >,
  handler: HybridLoaderHandlerFunction<
    TParamsSchema,
    TSearchParamsSchema,
    THeadersSchema,
    TResource
  >,
) {
  return async function loader({ request, params }: LoaderFunctionArgs) {
    const {
      params: paramsSchema,
      searchParams: searchParamsSchema,
      headers: headersSchema,
      allowJWT = false,
      corsStrategy = "none",
      authorization,
      findResource,
      shouldRetryNotFound,
    } = options;

    if (corsStrategy !== "none" && request.method.toUpperCase() === "OPTIONS") {
      return apiCors(request, json({}));
    }

    try {
      const authenticationResult = await authenticateHybridRequest(request, {
        allowJWT,
      });

      if (!authenticationResult) {
        return await wrapResponse(
          request,
          json({ error: "Authentication required" }, { status: 401 }),
          corsStrategy !== "none",
        );
      }

      let parsedParams: any = undefined;
      if (paramsSchema) {
        const parsed = paramsSchema.safeParse(params);
        if (!parsed.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Params Error",
                details: fromZodError(parsed.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedParams = parsed.data;
      }

      let parsedSearchParams: any = undefined;
      if (searchParamsSchema) {
        const searchParams = Object.fromEntries(
          new URL(request.url).searchParams,
        );
        const parsed = searchParamsSchema.safeParse(searchParams);
        if (!parsed.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Query Error",
                details: fromZodError(parsed.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedSearchParams = parsed.data;
      }

      let parsedHeaders: any = undefined;
      if (headersSchema) {
        const rawHeaders = Object.fromEntries(request.headers);
        const headers = headersSchema.safeParse(rawHeaders);
        if (!headers.success) {
          return await wrapResponse(
            request,
            json(
              {
                error: "Headers Error",
                details: fromZodError(headers.error).details,
              },
              { status: 400 },
            ),
            corsStrategy !== "none",
          );
        }
        parsedHeaders = headers.data;
      }

      // Find the resource
      const resource = await findResource(
        parsedParams,
        authenticationResult,
        parsedSearchParams,
      );

      if (!resource) {
        return await wrapResponse(
          request,
          json(
            { error: "Not found" },
            {
              status: 404,
              headers: {
                "x-should-retry": shouldRetryNotFound ? "true" : "false",
              },
            },
          ),
          corsStrategy !== "none",
        );
      }

      // Authorization check - only applies to API key authentication
      if (authorization && authenticationResult.type === "PRIVATE") {
        const { action, resource: authResource, superScopes } = authorization;
        const $authResource = authResource(
          resource,
          parsedParams,
          parsedSearchParams,
          parsedHeaders,
        );

        logger.debug("Checking authorization", {
          action,
          resource: $authResource,
          superScopes,
          scopes: authenticationResult.scopes,
        });

        const authorizationResult = checkAuthorization(authenticationResult);

        if (!authorizationResult.authorized) {
          return await wrapResponse(
            request,
            json(
              {
                error: `Unauthorized: ${authorizationResult.reason}`,
                code: "unauthorized",
                param: "access_token",
                type: "authorization",
              },
              { status: 403 },
            ),
            corsStrategy !== "none",
          );
        }
      }

      const result = await handler({
        params: parsedParams,
        searchParams: parsedSearchParams,
        headers: parsedHeaders,
        authentication: authenticationResult,
        request,
        resource,
      });
      return await wrapResponse(request, result, corsStrategy !== "none");
    } catch (error) {
      try {
        if (error instanceof Response) {
          return await wrapResponse(request, error, corsStrategy !== "none");
        }

        logger.error("Error in hybrid loader", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : String(error),
          url: request.url,
        });

        return await wrapResponse(
          request,
          json({ error: "Internal Server Error" }, { status: 500 }),
          corsStrategy !== "none",
        );
      } catch (innerError) {
        logger.error("[apiBuilder] Failed to handle error", {
          error,
          innerError,
        });

        return json({ error: "Internal Server Error" }, { status: 500 });
      }
    }
  };
}
