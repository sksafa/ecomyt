"use client";

import Link from "next/link";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { bdt } from "@/lib/format";
import { cart, cartCount, cartSubtotal, MAX_QTY, useCart, useCartDrawer, type CartLine } from "./cart";
import { Img } from "./ui";
import { storeThemeClass } from "./fonts";

export function QtyStepper({ value, onChange, max = MAX_QTY, label }: { value: number; onChange: (n: number) => void; max?: number; label: string }) {
  return (
    <div className="inline-flex h-10 items-center rounded-md border border-input bg-card" role="group" aria-label={label}>
      <button type="button" className="grid size-10 place-items-center disabled:opacity-40" onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="Decrease quantity">
        <Minus className="size-4" />
      </button>
      <span className="w-8 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className="grid size-10 place-items-center disabled:opacity-40" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export function CartLineRow({ line, onNavigate }: { line: CartLine; onNavigate?: () => void }) {
  return (
    <li className="flex gap-3 py-4">
      <Link href={`/products/${line.slug}`} onClick={onNavigate} className="shrink-0">
        <Img src={line.imageUrl} alt={line.name} className="h-24 w-20 rounded-md" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/products/${line.slug}`} onClick={onNavigate} className="line-clamp-2 text-sm font-medium hover:text-primary">
              {line.name}
            </Link>
            {line.variantName && <p className="mt-0.5 text-xs text-muted-foreground">{line.variantName}</p>}
          </div>
          <button type="button" className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive" aria-label={`Remove ${line.name}`} onClick={() => cart.remove(line.variantId)}>
            <Trash2 className="size-4" />
          </button>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <QtyStepper value={line.quantity} onChange={(n) => cart.setQty(line.variantId, n)} label={`Quantity of ${line.name}`} />
          <span className="text-sm font-semibold">{bdt(Number(line.price) * line.quantity)}</span>
        </div>
      </div>
    </li>
  );
}

export function CartDrawer() {
  const open = useCartDrawer();
  const lines = useCart();
  const close = () => cart.setDrawer(false);
  return (
    <Sheet open={open} onOpenChange={cart.setDrawer}>
      <SheetContent side="right" className={`${storeThemeClass} flex w-full flex-col gap-0 p-0 sm:max-w-md`}>
        <div className="border-b border-border px-5 py-4">
          <SheetTitle className="font-display text-2xl font-semibold">Your bag ({cartCount(lines)})</SheetTitle>
          <SheetDescription className="font-bengali text-xs">আপনার ব্যাগ</SheetDescription>
        </div>
        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <ShoppingBag className="size-10 text-muted-foreground" aria-hidden />
            <p className="font-display text-xl">Your bag is empty</p>
            <Link href="/shop" onClick={close} className="mt-2 inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground">
              Shop the collection
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border overflow-y-auto px-5">
              {lines.map((l) => (
                <CartLineRow key={l.variantId} line={l} onNavigate={close} />
              ))}
            </ul>
            <div className="pb-safe space-y-3 border-t border-border bg-card px-5 pt-4">
              <div className="flex items-center justify-between text-base">
                <span>Subtotal</span>
                <span className="font-semibold">{bdt(cartSubtotal(lines))}</span>
              </div>
              <p className="text-xs text-muted-foreground">Delivery charge is calculated at checkout. Cash on delivery available.</p>
              <Link href="/checkout" onClick={close} className="flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground hover:bg-primary/90">
                Checkout · অর্ডার করুন
              </Link>
              <Link href="/cart" onClick={close} className="block py-1 text-center text-sm text-primary underline-offset-4 hover:underline">
                View bag
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
