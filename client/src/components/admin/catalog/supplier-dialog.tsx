"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/admin/ui";
import type { Supplier } from "./shared";

/** Create / edit a supplier. Render with a `key` so the draft resets per supplier. */
export function SupplierDialog({ supplier, open, onClose }: { supplier?: Supplier | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState({
    name: supplier?.name ?? "", contactName: supplier?.contactName ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "",
    address: supplier?.address ?? "", notes: supplier?.notes ?? "", isActive: supplier?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: d.name.trim(), contactName: d.contactName.trim() || null, phone: d.phone.trim() || null, email: d.email.trim() || null,
        address: d.address.trim() || null, notes: d.notes.trim() || null, isActive: d.isActive,
      };
      return api<Supplier>(supplier ? `/suppliers/${supplier.id}` : "/suppliers", { method: supplier ? "PUT" : "POST", body });
    },
    onSuccess: () => {
      toast.success(supplier ? "Supplier updated" : "Supplier added");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["supplier"] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(errorMessage(e));
    },
  });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{supplier ? "Edit supplier" : "New supplier"}</DialogTitle></DialogHeader>
        <form
          id="supplier-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const local: Record<string, string> = {};
            if (d.name.trim().length < 2) local.name = "Name is required";
            if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) local.email = "Invalid email";
            setErrors(local);
            if (!Object.keys(local).length) save.mutate();
          }}
        >
          <div className="sm:col-span-2"><Field label="Business name" htmlFor="s-name" error={errors.name}><Input id="s-name" value={d.name} onChange={set("name")} autoFocus /></Field></div>
          <Field label="Contact person" htmlFor="s-contact" error={errors.contactName}><Input id="s-contact" value={d.contactName} onChange={set("contactName")} /></Field>
          <Field label="Phone" htmlFor="s-phone" error={errors.phone}><Input id="s-phone" inputMode="tel" value={d.phone} onChange={set("phone")} /></Field>
          <div className="sm:col-span-2"><Field label="Email" htmlFor="s-email" error={errors.email}><Input id="s-email" type="email" value={d.email} onChange={set("email")} /></Field></div>
          <div className="sm:col-span-2"><Field label="Address" htmlFor="s-addr" error={errors.address}><Textarea id="s-addr" rows={2} value={d.address} onChange={set("address")} /></Field></div>
          <div className="sm:col-span-2"><Field label="Notes" htmlFor="s-notes" error={errors.notes}><Textarea id="s-notes" rows={2} value={d.notes} onChange={set("notes")} placeholder="Payment terms, specialities…" /></Field></div>
          {supplier && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} /> Active</label>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="supplier-form" disabled={save.isPending}>{save.isPending && <Loader2 className="size-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
