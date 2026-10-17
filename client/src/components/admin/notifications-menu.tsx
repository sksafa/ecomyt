"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsMenu({ icon }: { icon: ReactNode }) {
  const qc = useQueryClient();
  const count = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api<{ count: number } | number>("/notifications/unread-count"),
    refetchInterval: 60_000,
    retry: false,
  });
  const list = useQuery({ queryKey: ["notifications", "list"], queryFn: () => api<Notification[]>("/notifications", { query: { pageSize: 15 } }), retry: false });
  const markAll = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const unread = typeof count.data === "number" ? count.data : (count.data?.count ?? 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unread} unread)`}>
          {icon}
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {list.isError && <p className="p-4 text-sm text-muted-foreground">Notifications are unavailable.</p>}
          {list.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">You&apos;re all caught up.</p>}
          {list.data?.map((n) => {
            const content = (
              <div className={cn("border-b px-3 py-2.5 text-sm hover:bg-muted/50", !n.readAt && "bg-accent/40")}>
                <div className="font-medium">{n.title}</div>
                <div className="line-clamp-2 text-muted-foreground">{n.body}</div>
                <div className="mt-1 text-xs text-muted-foreground">{ago(n.createdAt)}</div>
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link.startsWith("/admin") ? n.link : `/admin${n.link}`} onClick={() => !n.readAt && markOne.mutate(n.id)}>
                {content}
              </Link>
            ) : (
              <button key={n.id} className="block w-full text-left" onClick={() => !n.readAt && markOne.mutate(n.id)}>
                {content}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
