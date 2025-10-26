import { useLocation } from "@remix-run/react";
import posthog from "posthog-js";
import { useEffect, useRef } from "react";

import { useOptionalUser, useUserChanged } from "./useUser";

export const usePostHog = (
  apiKey?: string,
  telemetryEnabled = true,
  logging = false,
  debug = false,
): void => {
  const postHogInitialized = useRef(false);
  const location = useLocation();
  const user = useOptionalUser();

  //start PostHog once
  useEffect(() => {
    // Respect telemetry settings
    if (!telemetryEnabled) return;
    if (apiKey === undefined || apiKey === "") return;
    if (postHogInitialized.current === true) return;
    if (logging) console.log("Initializing PostHog");
    posthog.init(apiKey, {
      api_host: "/ph-relay-core20",
      ui_host: "https://us.posthog.com",
      opt_in_site_apps: true,
      debug,
      loaded: function (posthog) {
        if (logging) console.log("PostHog loaded");
        if (user !== undefined) {
          if (logging) console.log("Loaded: Identifying user", user);
          posthog.identify(user.id, {
            email: user.email,
            name: user.name,
          });
        }
      },
    });
    postHogInitialized.current = true;
  }, [apiKey, telemetryEnabled, logging, user]);

  useUserChanged((user) => {
    if (postHogInitialized.current === false) return;
    if (!telemetryEnabled) return;
    if (logging) console.log("User changed");
    if (user) {
      if (logging) console.log("Identifying user", user);
      posthog.identify(user.id, {
        email: user.email,
        name: user.name,
      });
    } else {
      if (logging) console.log("Resetting user");
      posthog.reset();
    }
  });

  //page view
  useEffect(() => {
    if (postHogInitialized.current === false) return;
    posthog.capture("$pageview");
  }, [location, logging]);
};
