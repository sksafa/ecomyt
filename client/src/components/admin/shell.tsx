"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, KeyRound, LogOut, Menu, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NAV } from "./nav";
import { GlobalSearch } from "./global-search";
import { NotificationsMenu } from "./notifications-menu";
import { useOrderStream } from "./use-order-stream";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/admin" className={cn("font-serif text-lg font-bold tracking-tight text-[#8a1c2b]", className)}>
      BENT<span className="text-sm">&amp;</span>BOUND
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { canAny } = useAuth();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <nav className="flex flex-col gap-0.5 p-3 text-sm" aria-label="Main">
      {NAV.filter((n) => canAny(...n.anyOf)).map((item) => {
        const Icon = item.icon;
        const open = isActive(item.href);
        const children = item.children?.filter((c) => canAny(...c.anyOf));
        // a parent links to the first child page this user may open
        const href = children?.length ? children[0].href : item.href;
        return (
          <div key={item.href}>
            <Link
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                open && "bg-accent text-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {children && children.length > 1 && <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />}
            </Link>
            {open && children && children.length > 1 && (
              <div className="ml-7 mt-0.5 flex flex-col border-l pl-2">
                {children.map((c) => (
                  <Link
                    key={c.href}
                    href={c.href}
                    onClick={onNavigate}
                    className={cn("rounded px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground", pathname === c.href && "font-semibold text-primary")}
                  >
                    {c.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { me, can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = usePathname();
  const [mobileNav, setMobileNav] = useState(false);
  useOrderStream(can("orders.view"));
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ status: string }>("/health"), refetchInterval: 60_000, retry: false });

  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the drawer on navigation
  useEffect(() => setMobileNav(false), [pathname]);

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      qc.clear();
      router.replace("/admin/login");
      toast.success("Signed out");
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-white px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
        <Logo className="w-40 shrink-0" />
        <div className="hidden max-w-md flex-1 md:block">
          <GlobalSearch />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="mr-2 hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 sm:inline-flex">
                <span className={cn("size-2 rounded-full", health.data?.status === "ok" ? "bg-emerald-500" : "bg-amber-500")} />
                {health.data?.status === "ok" ? "Live" : "Checking…"}
              </span>
            </TooltipTrigger>
            <TooltipContent>API and database status</TooltipContent>
          </Tooltip>
          {can("orders.create") && (
            <Button size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/admin/orders/new">
                <Plus className="size-4" /> New order
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Search">
            <Link href="/admin/orders">
              <Search className="size-5" />
            </Link>
          </Button>
          <NotificationsMenu icon={<Bell className="size-5" />} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                  {me.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-sm font-medium sm:inline">{me.name}</span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-medium">{me.name}</div>
                <div className="text-xs font-normal text-muted-foreground">{me.roles.map((r) => r.name).join(", ")}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/admin/profile">
                  <KeyRound className="size-4" /> Security & sessions
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout}>
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="no-print sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto border-r bg-white lg:block">
          <Sidebar />
        </aside>
        {mobileNav && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNav(false)} />
            <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-white shadow-xl">
              <div className="flex h-16 items-center justify-between border-b px-4">
                <Logo />
                <Button variant="ghost" size="icon" onClick={() => setMobileNav(false)} aria-label="Close menu">
                  <X className="size-5" />
                </Button>
              </div>
              <div className="p-3 md:hidden">
                <GlobalSearch />
              </div>
              <Sidebar onNavigate={() => setMobileNav(false)} />
            </div>
          </div>
        )}
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
