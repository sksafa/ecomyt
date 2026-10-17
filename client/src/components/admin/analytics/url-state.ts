"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * URL-synced filter state (same approach as the orders list). `set` resets `page` unless the patch
 * contains it, so changing a filter always returns to the first page.
 */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // keys are module-level constants in every caller
  const values = useMemo(() => Object.fromEntries(keys.map((k) => [k, params.get(k) ?? undefined])) as Partial<Record<K, string>>, [params, keys]);
  const set = useCallback(
    (patch: Partial<Record<K | "page", string | undefined>>) => {
      const next = new URLSearchParams(params.toString());
      const full: Record<string, string | undefined> = { ...patch };
      if (!("page" in patch)) full.page = undefined;
      for (const [k, v] of Object.entries(full)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return [values, set] as const;
}
