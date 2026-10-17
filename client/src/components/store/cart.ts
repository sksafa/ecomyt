"use client";

import { useSyncExternalStore } from "react";
import { track, contentData } from "./tracking";

/** Display snapshot only – the server reprices every line at checkout. */
export interface CartLine {
  variantId: string;
  sku: string;
  productId: string;
  slug: string;
  name: string;
  variantName: string | null;
  price: string;
  imageUrl: string | null;
  quantity: number;
  weightGrams?: number | null;
}

export const MAX_QTY = 10; // server limit per line
export const MAX_LINES = 20;
const KEY = "bb_cart_v1";
const EMPTY: CartLine[] = [];

let lines: CartLine[] = EMPTY;
let loaded = false;
let drawerOpen = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    lines = Array.isArray(parsed) ? (parsed as CartLine[]).filter((l) => l && typeof l.variantId === "string" && l.quantity > 0) : EMPTY;
  } catch {
    lines = EMPTY;
  }
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    loaded = false;
    load();
    emit();
  });
}

function emit() {
  for (const l of listeners) l();
}

function save(next: CartLine[]) {
  lines = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  emit();
}

function subscribe(cb: () => void) {
  load();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getLines = () => {
  load();
  return lines;
};

export const cart = {
  add(line: Omit<CartLine, "quantity">, quantity = 1, opts: { openDrawer?: boolean } = {}) {
    load();
    const existing = lines.find((l) => l.variantId === line.variantId);
    if (!existing && lines.length >= MAX_LINES) return false;
    const next = existing
      ? lines.map((l) => (l.variantId === line.variantId ? { ...l, ...line, quantity: Math.min(MAX_QTY, l.quantity + quantity) } : l))
      : [...lines, { ...line, quantity: Math.min(MAX_QTY, quantity) }];
    save(next);
    track("AddToCart", contentData([{ sku: line.sku, quantity, price: line.price }]));
    if (opts.openDrawer) cart.setDrawer(true);
    return true;
  },
  setQty(variantId: string, quantity: number) {
    load();
    save(quantity <= 0 ? lines.filter((l) => l.variantId !== variantId) : lines.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l)));
  },
  remove(variantId: string) {
    load();
    save(lines.filter((l) => l.variantId !== variantId));
  },
  clear() {
    save(EMPTY);
  },
  setDrawer(open: boolean) {
    drawerOpen = open;
    emit();
  },
};

/** Cart lines (empty during SSR / before hydration). */
export function useCart() {
  return useSyncExternalStore(subscribe, getLines, () => EMPTY);
}

export function useCartDrawer() {
  return useSyncExternalStore(
    subscribe,
    () => drawerOpen,
    () => false,
  );
}

export const cartCount = (ls: CartLine[]) => ls.reduce((s, l) => s + l.quantity, 0);
export const cartSubtotal = (ls: CartLine[]) => ls.reduce((s, l) => s + Number(l.price) * l.quantity, 0);

const noop = () => () => {};
/** false during SSR + hydration, true afterwards (avoids "empty bag" flashes for localStorage-backed UI). */
export function useHydrated() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
