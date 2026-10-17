"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { api } from "@/lib/api";
import { bdt, dhakaDateTime } from "@/lib/format";
import type { OrderListItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRows } from "@/components/admin/ui";

interface PrintData {
  store: { name: string; phone: string; email: string; address: string; tagline: string };
  orders: OrderListItem[];
}

/** Browser-printable invoices, packing slips and courier labels (Bengali text renders via the page font). */
function PrintScreen() {
  const params = useSearchParams();
  const type = params.get("type") ?? "invoice";
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const q = useQuery({ queryKey: ["print", ids], queryFn: () => api<PrintData>("/orders/print", { method: "POST", body: { ids } }), enabled: ids.length > 0 });

  useEffect(() => {
    if (q.data) setTimeout(() => window.print(), 400);
  }, [q.data]);

  if (q.isLoading) return <LoadingRows />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const { store, orders } = q.data;

  return (
    <div className="mx-auto max-w-4xl bg-white">
      <div className="no-print mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{orders.length} {type === "label" ? "labels" : type === "packing" ? "packing slips" : "invoices"}</p>
        <Button onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
      </div>

      {type === "label" ? (
        <div className="grid grid-cols-2 gap-3 print:gap-2">
          {orders.map((o) => (
            <div key={o.id} className="break-inside-avoid rounded border-2 border-black p-3 text-sm">
              <div className="flex justify-between border-b border-black pb-1 font-bold">
                <span className="font-serif">{store.name}</span>
                <span>{o.orderNumber}</span>
              </div>
              <div className="mt-2 text-xs uppercase">To</div>
              <div className="text-base font-bold">{o.shipping.name}</div>
              <div className="text-lg font-bold tracking-wide">{o.shipping.phone}</div>
              <div>{[o.shipping.address, o.shipping.area, o.shipping.district].filter(Boolean).join(", ")}</div>
              <div className="mt-2 flex justify-between border-t border-black pt-1">
                <span className="font-bold">COD: {bdt(o.amounts.due)}</span>
                <span>{o.items.reduce((n, i) => n + i.quantity, 0)} pcs</span>
              </div>
              {o.shipment?.trackingCode && <div className="mt-1 font-mono text-base">{o.shipment.provider.name}: {o.shipment.trackingCode}</div>}
              {o.shipping.note && <div className="mt-1 text-xs">Note: {o.shipping.note}</div>}
              <div className="mt-1 text-[10px]">From: {store.name}{store.phone ? `, ${store.phone}` : ""}</div>
            </div>
          ))}
        </div>
      ) : (
        orders.map((o) => (
          <article key={o.id} className="mb-8 break-after-page p-6 text-sm print:mb-0">
            <header className="flex justify-between border-b pb-3">
              <div>
                <div className="font-serif text-2xl font-bold text-[#8a1c2b]">{store.name}</div>
                <div className="text-xs text-muted-foreground">{store.tagline}</div>
                {store.address && <div className="text-xs">{store.address}</div>}
                {store.phone && <div className="text-xs">{store.phone}</div>}
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">{type === "packing" ? "Packing slip" : "Invoice"}</div>
                <div>{o.orderNumber}</div>
                <div className="text-xs">{dhakaDateTime(o.createdAt)}</div>
              </div>
            </header>
            <section className="my-4">
              <div className="text-xs uppercase text-muted-foreground">Deliver to</div>
              <div className="font-semibold">{o.shipping.name} · {o.shipping.phone}</div>
              <div>{[o.shipping.address, o.shipping.area, o.shipping.district].filter(Boolean).join(", ")}</div>
            </section>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1">Item</th>
                  <th className="py-1">Variant</th>
                  <th className="py-1 text-right">Qty</th>
                  {type !== "packing" && <th className="py-1 text-right">Price</th>}
                  {type !== "packing" && <th className="py-1 text-right">Amount</th>}
                  {type === "packing" && <th className="py-1 text-right">Packed ✓</th>}
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id} className="border-b">
                    <td className="py-1">{i.productName}<div className="text-xs text-muted-foreground">{i.sku}</div></td>
                    <td className="py-1">{[i.color, i.size].filter(Boolean).join(" / ") || i.variantName}</td>
                    <td className="py-1 text-right">{i.quantity}</td>
                    {type !== "packing" && <td className="py-1 text-right">{bdt(i.unitPrice)}</td>}
                    {type !== "packing" && <td className="py-1 text-right">{bdt(i.lineTotal)}</td>}
                    {type === "packing" && <td className="py-1 text-right">☐</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {type !== "packing" && (
              <dl className="ml-auto mt-3 w-64 space-y-0.5">
                <div className="flex justify-between"><dt>Subtotal</dt><dd>{bdt(o.amounts.subtotal)}</dd></div>
                <div className="flex justify-between"><dt>Discount</dt><dd>−{bdt(o.amounts.discount)}</dd></div>
                <div className="flex justify-between"><dt>Delivery</dt><dd>{bdt(o.amounts.deliveryCharge)}</dd></div>
                <div className="flex justify-between border-t font-semibold"><dt>Total</dt><dd>{bdt(o.amounts.total)}</dd></div>
                <div className="flex justify-between"><dt>Paid</dt><dd>{bdt(o.amounts.paid)}</dd></div>
                <div className="flex justify-between text-base font-bold"><dt>Due on delivery</dt><dd>{bdt(o.amounts.due)}</dd></div>
              </dl>
            )}
            <footer className="mt-6 text-center text-xs text-muted-foreground">ধন্যবাদ! Thank you for shopping with {store.name}.</footer>
          </article>
        ))
      )}
    </div>
  );
}

export default function PrintPage() {
  return (
    <Suspense>
      <PrintScreen />
    </Suspense>
  );
}
