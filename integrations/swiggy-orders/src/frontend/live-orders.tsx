import React from "react";
import type {
  WidgetSpec,
  WidgetRenderContext,
  WidgetComponent,
} from "@redplanethq/sdk";
import { LiveOrdersCard } from "./LiveOrdersCard.js";

export const liveOrdersWidget: WidgetSpec = {
  name: "Live Orders",
  slug: "live-orders",
  description:
    "Shows current Swiggy Food, Instamart and Dineout orders in one place.",
  support: ["webapp"],
  configSchema: [],

  async render({ pat, baseUrl }: WidgetRenderContext): Promise<WidgetComponent> {
    return function LiveOrders() {
      return <LiveOrdersCard pat={pat} baseUrl={baseUrl} />;
    };
  },
};
