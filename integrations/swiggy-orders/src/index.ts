import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from "@redplanethq/sdk";
import { fileURLToPath } from "url";

/**
 * Widget-only integration with no authentication. The only events ever
 * dispatched here are SPEC and (defensively) GET_TOOLS — installation goes
 * through the dedicated widget-install endpoint, not SETUP.
 */
export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.GET_TOOLS:
      return [];
    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class SwiggyOrdersCLI extends IntegrationCLI {
  constructor() {
    super("swiggy-orders", "1.0.0");
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: "Swiggy Live Orders",
      key: "swiggy-orders",
      description:
        "Live orders widget that aggregates active food, grocery and dineout orders from your connected Swiggy accounts.",
      icon: "swiggy-orders",
      widgets: [
        {
          name: "Live Orders",
          slug: "live-orders",
          description:
            "Shows current Swiggy Food, Instamart and Dineout orders in one place.",
          support: ["webapp"],
          configSchema: [],
        },
      ],
    };
  }
}

function main() {
  const cli = new SwiggyOrdersCLI();
  cli.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
