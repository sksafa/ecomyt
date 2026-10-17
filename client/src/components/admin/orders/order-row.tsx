"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, Camera, ChevronDown, Copy, Eye, Globe, History, MessageCircle, MessagesSquare, Pencil, Phone, Printer, ShoppingBag, Truck, UserRound,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { bdt, dhakaDay, dhakaTime, telHref, whatsappHref } from "@/lib/format";
import { ORDER_STATUS, SHIPMENT_TONE } from "@/lib/status";
import type { OrderListItem } from "@/lib/types";
import { IconAction, Pill } from "@/components/admin/ui";

const CHANNEL_ICON: Record<string, { icon: typeof Globe; label: string; className: string }> = {
  WEBSITE: { icon: Globe, label: "Website", className: "text-emerald-600" },
  FACEBOOK: { icon: MessagesSquare, label: "Facebook", className: "text-blue-600" },
  INSTAGRAM: { icon: Camera, label: "Instagram", className: "text-pink-600" },
  WHATSAPP: { icon: MessageCircle, label: "WhatsApp", className: "text-green-600" },
  PHONE: { icon: Phone, label: "Phone", className: "text-slate-600" },
  MANUAL: { icon: ShoppingBag, label: "Manual", className: "text-slate-600" },
  OTHER: { icon: ShoppingBag, label: "Other", className: "text-slate-500" },
};

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Could not copy");
  }
}

function RoundButton({ label, onClick, href, children }: { label: string; onClick?: () => void; href?: string; children: React.ReactNode }) {
  const cls = "inline-flex size-8 items-center justify-center rounded-full border bg-white text-slate-700 shadow-xs hover:bg-accent";
  return href ? (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={cls} aria-label={label} title={label}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-label={label} title={label}>
      {children}
    </button>
  );
}

export interface RowActions {
  onHistory: (o: OrderListItem) => void;
  onPrint: (o: OrderListItem) => void;
  onBook: (o: OrderListItem) => void;
  onStatus: (o: OrderListItem) => void;
  canEdit: boolean;
  canBook: boolean;
  canFinance: boolean;
}

export function OrderRow({ order: o, selected, onSelect, actions }: { order: OrderListItem; selected: boolean; onSelect: (v: boolean) => void; actions: RowActions }) {
  const [expanded, setExpanded] = useState(false);
  const channel = CHANNEL_ICON[o.channel] ?? CHANNEL_ICON.OTHER;
  const ChannelIcon = channel.icon;
  const status = ORDER_STATUS[o.status];
  const due = Number(o.amounts.due);
  const address = [o.shipping.address, o.shipping.area, o.shipping.district].filter(Boolean).join(", ");
  const editable = ["PENDING", "CONFIRMATION_REQUIRED", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "ON_HOLD"].includes(o.status);
  const bookable = ["CONFIRMED", "PROCESSING", "READY_TO_SHIP"].includes(o.status) && !o.shipment?.trackingCode;

  return (
    <div className={cn("border-b bg-white transition-colors", selected && "bg-accent/30")}>
      <div className="grid grid-cols-1 gap-4 px-4 py-5 lg:grid-cols-[28px_110px_minmax(0,1.6fr)_minmax(0,1.2fr)_170px_120px_150px] lg:items-center">
        <div className="hidden lg:block">
          <Checkbox checked={selected} onCheckedChange={(v) => onSelect(!!v)} aria-label={`Select ${o.orderNumber}`} />
        </div>

        {/* Date / channel */}
        <div className="flex items-center gap-3 lg:flex-col lg:items-center lg:gap-1 lg:text-center">
          <Checkbox className="lg:hidden" checked={selected} onCheckedChange={(v) => onSelect(!!v)} aria-label={`Select ${o.orderNumber}`} />
          <ChannelIcon className={cn("size-4", channel.className)} aria-label={channel.label} />
          <span className="text-sm text-muted-foreground">{dhakaTime(o.createdAt)}</span>
          <span className="text-base font-medium tabular-nums">{dhakaDay(o.createdAt)}</span>
          <Link href={`/admin/orders/${o.id}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:underline">
            {o.orderNumber}
          </Link>
        </div>

        {/* Customer */}
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold tabular-nums">{o.shipping.phone}</span>
            <RoundButton label="Customer history" href={`/admin/customers/${o.customer.id}`}>
              <UserRound className="size-4" />
            </RoundButton>
            <RoundButton label="Copy phone" onClick={() => copy(o.shipping.phone, "Phone")}>
              <Copy className="size-4" />
            </RoundButton>
            <RoundButton label="Call" href={telHref(o.shipping.phone)}>
              <Phone className="size-4" />
            </RoundButton>
            <RoundButton label="WhatsApp" href={whatsappHref(o.shipping.phone, `Assalamu alaikum, regarding your Bent & Bound order ${o.orderNumber}`)}>
              <MessageCircle className="size-4" />
            </RoundButton>
          </div>
          <div className="text-[15px] leading-snug">
            <div className="font-medium">{o.shipping.name}</div>
            <button type="button" onClick={() => copy(address, "Address")} className="text-left text-slate-700 hover:underline" title="Copy address">
              {address}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            <span>{o.customer.totalOrders} order{o.customer.totalOrders === 1 ? "" : "s"}</span>
            {o.customer.deliveredOrders > 0 && <span className="text-emerald-700">· {o.customer.deliveredOrders} delivered</span>}
            {o.customer.returnedOrders > 0 && <span className="text-rose-700">· {o.customer.returnedOrders} returned</span>}
            {o.assignedTo && <span>· assigned to {o.assignedTo.name}</span>}
            {o.isPreorder && <Pill tone="violet">Pre-order</Pill>}
          </div>
          {o.risk.flags.length > 0 && (
            <div className="flex max-w-md gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="font-bengali leading-relaxed">
                <p className="font-semibold">এই অর্ডারটি যাচাই করুন। অনুগ্রহ করে গ্রাহককে ফোন করে অর্ডারটি নিশ্চিত করুন।</p>
                <ul className="mt-0.5 list-disc pl-4">
                  {o.risk.flags.map((f) => (
                    <li key={f.code}>
                      {f.bn} <span className="text-amber-700">({f.en})</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Products */}
        <div className="space-y-2">
          {o.items.map((i) => (
            <div key={i.id} className="flex gap-2 rounded-md border bg-slate-50/60 p-1.5">
              {i.imageUrl ? (
                <img src={i.imageUrl} alt="" className="size-10 shrink-0 rounded object-cover" />
              ) : (
                <div className="size-10 shrink-0 rounded bg-muted" />
              )}
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium">
                  {i.productName} <span className="font-semibold text-red-600">×{i.quantity}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs">
                  {i.size && <span className="text-blue-700">Size: {i.size}</span>}
                  {i.color && <span className="text-slate-700">Color: {i.color}</span>}
                  {!i.size && !i.color && <span className="text-muted-foreground">{i.sku}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* COD */}
        <div className="space-y-1 text-sm">
          <div className="inline-flex rounded-md border px-2 py-0.5 font-semibold">Bill : {bdt(o.amounts.total)}</div>
          <div className="block">
            <span className="inline-flex rounded-md border border-blue-200 px-2 py-0.5 font-semibold text-blue-700">Paid : {bdt(o.amounts.paid)}</span>
          </div>
          <div className="block">
            <span className={cn("inline-flex rounded-md border px-2 py-0.5 font-semibold", due > 0 ? "border-red-400 text-red-600" : "border-emerald-300 text-emerald-700")}>
              Due : {bdt(o.amounts.due)}
            </span>
          </div>
          {actions.canFinance && o.amounts.productMargin !== undefined && (
            <div className="text-xs text-emerald-700">
              Product margin: <span className="font-semibold">{bdt(o.amounts.productMargin)}</span>
            </div>
          )}
          <div className="text-xs text-muted-foreground">{o.paymentMethod === "COD" ? "Cash on delivery" : o.paymentMethod}</div>
        </div>

        {/* Status */}
        <div className="flex flex-col items-start gap-1.5 lg:items-center">
          <button type="button" onClick={() => actions.onStatus(o)} title="Change status">
            <Pill tone={status.tone} className="border-dashed px-3 py-1 text-sm hover:opacity-80">
              {status.en}
            </Pill>
          </button>
          {o.shipment && (
            <Pill tone={SHIPMENT_TONE[o.shipment.status] ?? "gray"} className="text-[11px]">
              {o.shipment.provider.name}
              {o.shipment.trackingCode ? ` · ${o.shipment.trackingCode}` : ` · ${o.shipment.status.toLowerCase()}`}
            </Pill>
          )}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-4 justify-items-center gap-1 lg:grid-cols-4">
          <IconAction label="Status history" onClick={() => actions.onHistory(o)}>
            <History className="size-[18px]" />
          </IconAction>
          {actions.canEdit && editable ? (
            <IconAction label="Edit order" href={`/admin/orders/${o.id}/edit`}>
              <Pencil className="size-[18px]" />
            </IconAction>
          ) : (
            <IconAction label="Editing locked after shipping" disabled>
              <Pencil className="size-[18px]" />
            </IconAction>
          )}
          <IconAction label="Print invoice / label" onClick={() => actions.onPrint(o)} className="bg-slate-100">
            <Printer className="size-[18px]" />
          </IconAction>
          <IconAction label="View details" href={`/admin/orders/${o.id}`}>
            <Eye className="size-[18px]" />
          </IconAction>
          <IconAction label={bookable ? "Book courier" : o.shipment ? "Courier booked" : "Confirm the order before booking"} onClick={() => actions.onBook(o)} disabled={!actions.canBook || !bookable}>
            <Truck className="size-[18px]" />
          </IconAction>
          <IconAction label="Copy order summary" onClick={() => copy(`${o.orderNumber}\n${o.shipping.name}\n${o.shipping.phone}\n${address}\nCOD: ${bdt(o.amounts.due)}`, "Order summary")}>
            <Copy className="size-[18px]" />
          </IconAction>
          <IconAction label={expanded ? "Hide details" : "More details"} onClick={() => setExpanded((v) => !v)} className="col-span-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700">
            <ChevronDown className={cn("size-5 transition-transform", expanded && "rotate-180")} />
          </IconAction>
        </div>
      </div>

      {expanded && (
        <div className="grid gap-4 border-t bg-slate-50/60 px-4 py-3 text-sm md:grid-cols-3 lg:pl-[150px]">
          <div>
            <p className="font-medium">Amounts</p>
            <p>Subtotal {bdt(o.amounts.subtotal)} · Discount {bdt(o.amounts.discount)} · Delivery {bdt(o.amounts.deliveryCharge)}</p>
            {o.amounts.refunded !== "0.00" && Number(o.amounts.refunded) > 0 && <p className="text-rose-700">Refunded {bdt(o.amounts.refunded)}</p>}
          </div>
          <div>
            <p className="font-medium">Delivery</p>
            <p>{o.shipping.note || "No delivery note"}</p>
            {o.shipment?.lastError && <p className="text-red-600">Courier: {o.shipment.lastError}</p>}
          </div>
          <div>
            <p className="font-medium">Source</p>
            <p>
              {o.channel.toLowerCase()}
              {o.attribution?.lastCampaign ? ` · ${o.attribution.lastSource ?? ""} / ${o.attribution.lastCampaign}` : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
