import React, { useCallback, useEffect, useMemo, useState } from "react";
import { callAction, fetchSwiggyAccounts, type ConnectedAccount } from "./api.js";

export interface LiveOrdersCardProps {
  pat: string;
  baseUrl: string;
}

interface NormalizedOrder {
  id: string;
  source: "food" | "instamart" | "dineout";
  title: string;
  status: string;
  subtitle?: string;
  updatedAt?: string;
}

const SOURCE_LABEL: Record<NormalizedOrder["source"], string> = {
  food: "Food",
  instamart: "Instamart",
  dineout: "Dineout",
};

function normalizeFood(raw: unknown): NormalizedOrder[] {
  const arr = Array.isArray(raw) ? raw : (raw as any)?.orders ?? [];
  return (arr as any[]).map((o: any, i: number) => ({
    id: String(o.order_id ?? o.id ?? `food-${i}`),
    source: "food",
    title: o.restaurant_name ?? o.restaurant?.name ?? "Food order",
    status: o.status ?? o.order_status ?? "Pending",
    subtitle: o.eta ?? o.delivery_eta ?? o.expected_delivery_time,
    updatedAt: o.updated_at ?? o.placed_at,
  }));
}

function normalizeInstamart(raw: unknown): NormalizedOrder[] {
  const arr = Array.isArray(raw) ? raw : (raw as any)?.orders ?? [];
  return (arr as any[]).map((o: any, i: number) => ({
    id: String(o.order_id ?? o.id ?? `im-${i}`),
    source: "instamart",
    title: o.store_name ?? "Instamart order",
    status: o.status ?? o.order_status ?? "Pending",
    subtitle: o.eta ?? o.delivery_eta,
    updatedAt: o.updated_at ?? o.placed_at,
  }));
}

function normalizeDineout(raw: unknown): NormalizedOrder[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return (arr as any[]).map((b: any, i: number) => ({
    id: String(b.booking_id ?? b.id ?? `dineout-${i}`),
    source: "dineout",
    title: b.restaurant_name ?? "Dineout reservation",
    status: b.status ?? "Confirmed",
    subtitle:
      b.date && b.time
        ? `${b.date} · ${b.time} · ${b.guests ?? "?"} guests`
        : b.deal_title,
    updatedAt: b.updated_at,
  }));
}

async function loadOrdersFor(
  baseUrl: string,
  pat: string,
  accounts: Record<string, ConnectedAccount | undefined>,
): Promise<NormalizedOrder[]> {
  const tasks: Array<Promise<NormalizedOrder[]>> = [];

  if (accounts["swiggy-food"]) {
    tasks.push(
      callAction(baseUrl, accounts["swiggy-food"]!.id, pat, "get_food_orders").then(
        normalizeFood,
        () => [],
      ),
    );
  }
  if (accounts["swiggy-instamart"]) {
    tasks.push(
      callAction(baseUrl, accounts["swiggy-instamart"]!.id, pat, "get_orders").then(
        normalizeInstamart,
        () => [],
      ),
    );
  }
  if (accounts["swiggy-dineout"]) {
    tasks.push(
      callAction(
        baseUrl,
        accounts["swiggy-dineout"]!.id,
        pat,
        "get_booking_status",
      ).then(normalizeDineout, () => []),
    );
  }

  const results = await Promise.all(tasks);
  return results.flat();
}

export function LiveOrdersCard({ pat, baseUrl }: LiveOrdersCardProps) {
  const [orders, setOrders] = useState<NormalizedOrder[]>([]);
  const [accounts, setAccounts] = useState<Record<string, ConnectedAccount | undefined>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accs = await fetchSwiggyAccounts(baseUrl, pat);
      setAccounts(accs);
      const next = await loadOrdersFor(baseUrl, pat, accs);
      setOrders(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, pat]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const hasAnyAccount = useMemo(
    () => Object.values(accounts).some(Boolean),
    [accounts],
  );

  const containerStyle: React.CSSProperties = {
    width: "100%",
    overflow: "hidden",
    borderRadius: 6,
  };
  const headerStyle: React.CSSProperties = {
    padding: "8px 10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    fontWeight: 600,
  };
  const bodyStyle: React.CSSProperties = { padding: "8px 10px", fontSize: 12 };
  const rowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
    gap: 2,
  };
  const tagStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--muted-foreground)",
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span>Live Swiggy orders</span>
        <button
          onClick={refresh}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--muted-foreground)",
            fontSize: 11,
          }}
          disabled={loading}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      <div style={bodyStyle}>
        {error && <div style={{ color: "var(--destructive)" }}>{error}</div>}
        {!error && !hasAnyAccount && (
          <div style={{ color: "var(--muted-foreground)" }}>
            Connect Swiggy Food, Instamart or Dineout to see live orders here.
          </div>
        )}
        {!error && hasAnyAccount && orders.length === 0 && !loading && (
          <div style={{ color: "var(--muted-foreground)" }}>
            No active orders right now.
          </div>
        )}
        {orders.map((o) => (
          <div key={`${o.source}-${o.id}`} style={rowStyle}>
            <span style={tagStyle}>{SOURCE_LABEL[o.source]}</span>
            <span style={{ fontWeight: 600 }}>{o.title}</span>
            <span style={{ color: "var(--muted-foreground)" }}>
              {o.status}
              {o.subtitle ? ` · ${o.subtitle}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
