"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { bdt } from "@/lib/format";

interface OrderMessage {
  type: "order.created" | "order.updated" | "order.status_changed";
  orderId?: string;
  orderNumber?: string;
  channel?: string;
  name?: string;
  total?: string;
}

/**
 * Keeps admin order screens live. The API pushes a small notice over Server-Sent Events whenever an order
 * is created or changed (after the DB commit); we only invalidate cached queries so the screens re-fetch
 * from the API. The stream never inserts rows itself, so a repeated or missed notice cannot duplicate
 * orders – the list always shows what the database returns.
 */
export function useOrderStream(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let flush: ReturnType<typeof setTimeout> | undefined;
    let connectedBefore = false;
    let stopped = false;
    const touched = new Set<string>();

    // coalesce bursts (bulk status changes) into one refetch per screen
    const refresh = (orderId?: string) => {
      if (orderId) touched.add(orderId);
      clearTimeout(flush);
      flush = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["orders"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
        for (const id of touched) qc.invalidateQueries({ queryKey: ["order", id] });
        touched.clear();
      }, 300);
    };

    const connect = () => {
      source = new EventSource("/api/v1/orders/stream", { withCredentials: true });
      source.addEventListener("ready", () => {
        // after a reconnect, catch up on anything that happened while disconnected
        if (connectedBefore) refresh();
        connectedBefore = true;
      });
      source.addEventListener("order", (e) => {
        let m: OrderMessage;
        try {
          m = JSON.parse((e as MessageEvent<string>).data);
        } catch {
          return;
        }
        refresh(m.orderId);
        if (m.type === "order.created" && m.channel === "WEBSITE") {
          toast.info(`New order ${m.orderNumber}`, { description: [m.name, m.total && bdt(m.total)].filter(Boolean).join(" · ") });
        }
      });
      source.onerror = () => {
        // the browser retries by itself unless the server refused (e.g. session expired); then back off
        if (source?.readyState === EventSource.CLOSED && !stopped) {
          clearTimeout(retry);
          retry = setTimeout(connect, 15_000);
        }
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(flush);
      source?.close();
    };
  }, [enabled, qc]);
}
