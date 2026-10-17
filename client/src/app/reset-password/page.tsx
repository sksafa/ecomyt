import { redirect } from "next/navigation";

// Password-reset emails link to /reset-password; the form lives in the admin area.
export default async function ResetRedirect({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  redirect(`/admin/reset-password${token ? `?token=${encodeURIComponent(token)}` : ""}`);
}
