"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export interface Account {
  id: string;
  name: string;
  type: "CASH" | "BANK" | "MOBILE_WALLET" | "OTHER";
  accountNumber: string | null;
  openingBalance: string;
  isActive: boolean;
  createdAt: string;
  balance: string;
}

export const ACCOUNT_TYPES = ["CASH", "BANK", "MOBILE_WALLET", "OTHER"] as const;

/** Accounts with balances (finance.view). Disabled for users without it so pickers degrade gracefully. */
export function useAccounts() {
  const { can } = useAuth();
  return useQuery({ queryKey: ["finance", "accounts"], queryFn: () => api<Account[]>("/finance/accounts"), enabled: can("finance.view"), staleTime: 60_000 });
}

export const ENTRY_TYPE_LABEL: Record<string, string> = {
  SALES_REVENUE: "Sales revenue",
  SHIPPING_REVENUE: "Shipping revenue",
  COGS: "Cost of goods",
  COURIER_FEE: "Courier fee",
  COD_FEE: "COD charge",
  RETURN_FEE: "Return fee",
  PACKAGING_COST: "Packaging",
  REFUND: "Refund",
  RETURN_REVERSAL: "Return reversal",
  RESTOCK_RECOVERY: "Restock recovery",
  EXPENSE: "Expense",
  AD_SPEND: "Advertising",
  PAYMENT_RECEIVED: "Payment received",
  SETTLEMENT_RECEIVED: "Courier settlement",
  SUPPLIER_PAYMENT: "Supplier payment",
  ADJUSTMENT: "Adjustment",
};

export const METHOD_LABEL: Record<string, string> = {
  COD: "COD", BKASH: "bKash", NAGAD: "Nagad", ROCKET: "Rocket", SSLCOMMERZ: "SSLCommerz", CARD: "Card", BANK_TRANSFER: "Bank transfer", CASH: "Cash",
};
export const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;
