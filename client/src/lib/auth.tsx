"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError } from "./api";

export interface Me {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  roles: { key: string; name: string }[];
  permissions: string[];
}

interface AuthCtx {
  me: Me;
  can: (...permissions: string[]) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export const meQueryKey = ["auth", "me"] as const;

/** Loads the signed-in user; redirects to the login page when the session is missing or expired. */
export function AuthGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: meQueryKey,
    queryFn: () => api<Me>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onUnauthorized = () => {
      qc.removeQueries({ queryKey: meQueryKey });
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
    };
    window.addEventListener("bb:unauthorized", onUnauthorized);
    return () => window.removeEventListener("bb:unauthorized", onUnauthorized);
  }, [qc, router, pathname]);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }, [error, router, pathname]);

  if (isLoading || !data) return <>{fallback}</>;
  const set = new Set(data.permissions);
  const value: AuthCtx = {
    me: data,
    can: (...p) => p.every((x) => set.has(x)),
    canAny: (...p) => p.some((x) => set.has(x)),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthGate>");
  return v;
}

/** Renders children only when the user has all listed permissions (UI convenience – the API enforces it too). */
export function Can({ permission, children, fallback = null }: { permission: string | string[]; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAuth();
  const list = Array.isArray(permission) ? permission : [permission];
  return <>{can(...list) ? children : fallback}</>;
}
