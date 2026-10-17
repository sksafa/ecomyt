"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/admin/ui";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!token) return <p className="text-sm text-red-600">This reset link is missing its token.</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password !== confirm) return setError("Passwords do not match");
        setError(null);
        try {
          await api("/auth/reset-password", { method: "POST", body: { token, password } });
          setDone(true);
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <h1 className="text-lg font-semibold">Choose a new password</h1>
      {done ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Password updated. <Link href="/admin/login" className="font-medium underline">Sign in</Link>
        </p>
      ) : (
        <>
          <Field label="New password" htmlFor="pw" hint="At least 8 characters with letters and numbers">
            <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </Field>
          <Field label="Repeat password" htmlFor="pw2">
            <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full">Update password</Button>
        </>
      )}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
