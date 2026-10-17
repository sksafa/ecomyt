"use client";

import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { ApiError, errorMessage } from "@/lib/api";

/** Maps a 422 VALIDATION_ERROR onto form fields; always toasts the message. */
export function handleFormError<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>) {
  if (e instanceof ApiError) {
    for (const [path, message] of Object.entries(e.fieldErrors)) setError(path.replace(/^body\./, "") as Path<T>, { message });
  }
  toast.error(errorMessage(e));
}

export const MONEY_RE = /^\d+(\.\d{1,2})?$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
