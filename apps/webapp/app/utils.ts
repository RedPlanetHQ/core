import { useMatches, type UIMatch } from "@remix-run/react";

const DEFAULT_REDIRECT = "/";

/**
 * This should be used any time the redirect path is user-provided
 * (Like the query string on our login/signup pages). This avoids
 * open-redirect vulnerabilities.
 * @param {string} to The redirect destination
 * @param {string} defaultRedirect The redirect to use if the to is unsafe.
 */
export function safeRedirect(
  to: FormDataEntryValue | string | null | undefined,
  defaultRedirect: string = DEFAULT_REDIRECT,
) {
  if (!to || typeof to !== "string") {
    return defaultRedirect;
  }

  if (!to.startsWith("/") || to.startsWith("//")) {
    return defaultRedirect;
  }

  return to;
}

/**
 * This base hook is used in other hooks to quickly search for specific data
 * across all loader data using useMatches.
 * @param {string} id The route id
 * @returns {JSON|undefined} The router data or undefined if not found
 */
export function useMatchesData(
  id: string | string[],
  debug: boolean = false,
): UIMatch | undefined {
  const matchingRoutes = useMatches();

  const paths = Array.isArray(id) ? id : [id];

  // Get the first matching route
  const route = paths.reduce(
    (acc, path) => {
      if (acc) return acc;
      return matchingRoutes.find((route) => route.id === path);
    },
    undefined as UIMatch | undefined,
  );

  return route;
}

export function validateEmail(email: unknown): email is string {
  return typeof email === "string" && email.length > 3 && email.includes("@");
}

export function hydrateObject<T>(object: any): T {
  return hydrateDates(object) as T;
}

export function hydrateDates(object: any): any {
  if (object === null || object === undefined) {
    return object;
  }

  if (object instanceof Date) {
    return object;
  }

  if (
    typeof object === "string" &&
    object.match(/\d{4}-\d{2}-\d{2}/) &&
    !Number.isNaN(Date.parse(object))
  ) {
    return new Date(object);
  }

  if (typeof object === "object") {
    if (Array.isArray(object)) {
      return object.map((item) => hydrateDates(item));
    } else {
      const hydratedObject: any = {};
      for (const key in object) {
        hydratedObject[key] = hydrateDates(object[key]);
      }
      return hydratedObject;
    }
  }

  return object;
}

export function titleCase(original: string): string {
  return original
    .split(" ")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export const obfuscateApiKey = (apiKey: string) => {
  const [prefix, slug, secretPart] = apiKey.split("_");
  return `${prefix}_${slug}_${"*".repeat(secretPart.length)}`;
};

export function appEnvTitleTag(appEnv?: string): string {
  if (!appEnv || appEnv === "production") {
    return "";
  }

  return ` (${appEnv})`;
}
