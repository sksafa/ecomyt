"use client";

import Link from "next/link";
import { bdt } from "@/lib/format";
import { cartCount, cartSubtotal, useCart } from "./cart";
import { CartLineRow } from "./cart-drawer";
import { Container, EmptyBlock, TrustBadges } from "./ui";

export function CartView() {
  const lines = useCart();
  return (
    <Container className="py-8 sm:py-10">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        Your bag <span className="font-bengali text-xl text-muted-foreground">· আপনার ব্যাগ</span>
      </h1>
      {lines.length === 0 ? (
        <div className="mt-6">
          <EmptyBlock
            title="Your bag is empty"
            text="Browse our embroidered orna and add your favourites."
            action={
              <Link href="/shop" className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground">
                Shop now
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <ul className="divide-y divide-border rounded-xl border border-border bg-card px-4 sm:px-5">
            {lines.map((l) => (
              <CartLineRow key={l.variantId} line={l} />
            ))}
          </ul>
          <aside className="h-fit space-y-4 rounded-xl border border-border bg-card p-5 lg:sticky lg:top-24">
            <div className="flex justify-between text-sm">
              <span>Items</span>
              <span>{cartCount(lines)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span>Subtotal</span>
              <span>{bdt(cartSubtotal(lines))}</span>
            </div>
            <p className="text-xs text-muted-foreground">Delivery charge is added at checkout based on your district. Final prices are confirmed when you place the order.</p>
            <Link href="/checkout" className="flex h-12 items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground hover:bg-primary/90">
              Proceed to checkout
            </Link>
            <Link href="/shop" className="block text-center text-sm text-primary underline-offset-4 hover:underline">
              Continue shopping
            </Link>
          </aside>
        </div>
      )}
      <TrustBadges className="mt-10" />
    </Container>
  );
}
