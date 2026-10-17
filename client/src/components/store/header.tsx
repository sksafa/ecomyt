"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Menu, Search, ShoppingBag, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { cart, cartCount, useCart } from "./cart";
import { storeThemeClass } from "./fonts";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/shop", label: "Shop all" },
  { href: "/order-status", label: "Track order", bn: "অর্ডার ট্র্যাক" },
  { href: "/faq", label: "FAQ" },
];

export function Wordmark({ name, logoUrl, className }: { name: string; logoUrl?: string | null; className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2", className)} aria-label={`${name} home`}>
      {logoUrl ? <img src={logoUrl} alt="" className="h-8 w-auto" /> : null}
      <span className="font-display text-2xl font-semibold tracking-wide text-[var(--bb-maroon)] sm:text-[1.7rem]">{name}</span>
    </Link>
  );
}

export function StoreHeader({ storeName, logoUrl, collections }: { storeName: string; logoUrl?: string | null; collections: { name: string; slug: string }[] }) {
  const lines = useCart();
  const count = cartCount(lines);
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchOpen(false);
    router.push(q.trim() ? `/shop?search=${encodeURIComponent(q.trim())}` : "/shop");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[var(--bb-ivory)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--bb-ivory)]/85">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-2 sm:h-16 sm:px-6">
        <button type="button" className="grid size-11 place-items-center rounded-md md:hidden" aria-label="Open menu" onClick={() => setMenu(true)}>
          <Menu className="size-5" />
        </button>
        <Wordmark name={storeName} logoUrl={logoUrl} className="mx-auto md:mx-0" />
        <nav className="ml-8 hidden items-center gap-6 md:flex" aria-label="Main">
          {NAV.slice(1).map((n) => (
            <Link key={n.href} href={n.href} className={cn("text-sm text-foreground/80 hover:text-primary", pathname === n.href && "font-medium text-primary")}>
              {n.label}
            </Link>
          ))}
          {collections.slice(0, 3).map((c) => (
            <Link key={c.slug} href={`/collections/${c.slug}`} className={cn("text-sm text-foreground/80 hover:text-primary", pathname === `/collections/${c.slug}` && "font-medium text-primary")}>
              {c.name}
            </Link>
          ))}
        </nav>
        <div className="flex items-center md:ml-auto">
          <button type="button" className="grid size-11 place-items-center rounded-md hover:bg-secondary" aria-label="Search" onClick={() => setSearchOpen((v) => !v)}>
            {searchOpen ? <X className="size-5" /> : <Search className="size-5" />}
          </button>
          <button type="button" className="relative grid size-11 place-items-center rounded-md hover:bg-secondary" aria-label={`Cart, ${count} items`} onClick={() => cart.setDrawer(true)}>
            <ShoppingBag className="size-5" />
            {count > 0 && (
              <span className="absolute right-1 top-1 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-5 text-primary-foreground">{count}</span>
            )}
          </button>
        </div>
      </div>
      {searchOpen && (
        <form onSubmit={submitSearch} className="border-t border-border bg-card px-4 py-3" role="search">
          <div className="mx-auto flex max-w-6xl gap-2">
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search orna, fabric… / খুঁজুন"
              aria-label="Search products"
              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base outline-none focus:border-primary"
            />
            <button type="submit" className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Search
            </button>
          </div>
        </form>
      )}

      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className={`${storeThemeClass} w-[85%] max-w-sm gap-0 p-0`}>
          <SheetTitle className="border-b border-border px-5 py-4">
            <span className="font-display text-2xl text-[var(--bb-maroon)]">{storeName}</span>
          </SheetTitle>
          <nav className="flex flex-col p-2" aria-label="Mobile">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMenu(false)} className="flex min-h-12 items-center justify-between rounded-md px-3 text-base hover:bg-secondary">
                {n.label}
                {n.bn && <span className="font-bengali text-xs text-muted-foreground">{n.bn}</span>}
              </Link>
            ))}
            {collections.length > 0 && <p className="px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">Collections</p>}
            {collections.map((c) => (
              <Link key={c.slug} href={`/collections/${c.slug}`} onClick={() => setMenu(false)} className="flex min-h-12 items-center rounded-md px-3 text-base hover:bg-secondary">
                {c.name}
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
