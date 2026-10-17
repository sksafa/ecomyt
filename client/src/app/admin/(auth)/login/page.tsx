"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/admin/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [step, setStep] = useState<"password" | "2fa">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = params.get("next");
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ["auth", "me"] });
    router.replace(next && next.startsWith("/admin") ? next : "/admin");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === "password") {
        const r = await api<{ twoFactorRequired: boolean }>("/auth/login", { method: "POST", body: { email, password } });
        if (r.twoFactorRequired) setStep("2fa");
        else await done();
      } else {
        await api("/auth/2fa/verify", { method: "POST", body: { code } });
        await done();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-lg font-semibold">{step === "password" ? "Sign in" : "Two-factor authentication"}</h1>
      {step === "password" ? (
        <>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
        </>
      ) : (
        <Field label="6-digit code from your authenticator app" htmlFor="code">
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus maxLength={8} />
        </Field>
      )}
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {step === "password" ? "Sign in" : "Verify"}
      </Button>
      <div className="text-center text-sm">
        <Link href="/admin/forgot-password" className="text-muted-foreground hover:text-foreground hover:underline">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
