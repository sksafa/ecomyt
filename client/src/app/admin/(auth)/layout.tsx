import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-teal-50 via-white to-rose-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center font-serif text-2xl font-bold text-[#8a1c2b]">
          BENT<span className="text-lg">&amp;</span>BOUND
          <p className="mt-1 font-sans text-sm font-normal text-muted-foreground">Management console</p>
        </div>
        <div className="rounded-xl border bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
