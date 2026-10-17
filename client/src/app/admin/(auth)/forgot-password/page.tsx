"use client";

import { useState } from "react";
import Link from "next/link";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/admin/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ message: string }>("/auth/forgot-password", { method: "POST", body: { email } });
          setSent(r.message);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="text-lg font-semibold">Reset your password</h1>
      {sent ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{sent}</p>
      ) : (
        <>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            Send reset link
          </Button>
        </>
      )}
      <p className="text-center text-sm">
        <Link href="/admin/login" className="text-muted-foreground hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
