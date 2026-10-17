"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { bdt } from "@/lib/format";
import { useCart, useHydrated } from "./cart";
import { CheckoutForm } from "./checkout-form";
import { Container, EmptyBlock, Img } from "./ui";

export function CheckoutView() {
  const lines = useCart();
  const hydrated = useHydrated();

  if (!hydrated) {
    return (
      <Container className="py-10">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="mt-6 h-96 animate-pulse rounded-xl bg-secondary/70" />
      </Container>
    );
  }

  if (!lines.length) {
    return (
      <Container className="py-10">
        <EmptyBlock
          title="Your bag is empty"
          text="Add a piece to your bag to check out."
          action={
            <Link href="/shop" className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground">
              Shop now
            </Link>
          }
        />
      </Container>
    );
  }

  return (
    <Container className="py-6 sm:py-10">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        Checkout <span className="font-bengali text-xl text-muted-foreground">· অর্ডার করুন</span>
      </h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-emerald-700" aria-hidden /> No account needed. Pay cash when your orna arrives.
      </p>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="ship-h" className="order-2 rounded-xl border border-border bg-card p-4 sm:p-6 lg:order-1">
          <h2 id="ship-h" className="mb-4 font-display text-xl font-semibold">
            Delivery details · <span className="font-bengali">ডেলিভারি তথ্য</span>
          </h2>
          <CheckoutForm lines={lines} source="cart" />
        </section>
        <aside aria-labelledby="sum-h" className="order-1 h-fit rounded-xl border border-border bg-card p-4 sm:p-5 lg:sticky lg:top-24 lg:order-2">
          <div className="flex items-center justify-between">
            <h2 id="sum-h" className="font-display text-xl font-semibold">Your order</h2>
            <Link href="/cart" className="text-sm text-primary underline-offset-4 hover:underline">
              Edit
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {lines.map((l) => (
              <li key={l.variantId} className="flex gap-3 py-3">
                <div className="relative shrink-0">
                  <Img src={l.imageUrl} alt={l.name} className="h-16 w-14 rounded-md" />
                  <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-[11px] text-background">{l.quantity}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm">{l.name}</p>
                  {l.variantName && <p className="text-xs text-muted-foreground">{l.variantName}</p>}
                </div>
                <span className="text-sm font-medium">{bdt(Number(l.price) * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Prices and delivery charge are confirmed by our system when you place the order.</p>
        </aside>
      </div>
    </Container>
  );
}
