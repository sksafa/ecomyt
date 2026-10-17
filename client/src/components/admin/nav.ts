import {
  BarChart3, Boxes, ClipboardList, FileText, LayoutDashboard, Megaphone, Package, RotateCcw, Settings, ShieldCheck,
  ShoppingCart, Truck, Users, Wallet, Warehouse, Newspaper, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** any of these permissions shows the item */
  anyOf: string[];
  children?: { href: string; label: string; anyOf: string[] }[];
}

export const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, anyOf: ["dashboard.view"] },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart, anyOf: ["orders.view"] },
  { href: "/admin/customers", label: "Customers", icon: Users, anyOf: ["customers.view"] },
  {
    href: "/admin/products", label: "Catalog", icon: Package, anyOf: ["products.view"],
    children: [
      { href: "/admin/products", label: "Products", anyOf: ["products.view"] },
      { href: "/admin/products/categories", label: "Categories & collections", anyOf: ["products.view"] },
    ],
  },
  { href: "/admin/inventory", label: "Inventory", icon: Boxes, anyOf: ["inventory.view"] },
  {
    href: "/admin/purchasing", label: "Purchasing", icon: Warehouse, anyOf: ["purchasing.view"],
    children: [
      { href: "/admin/purchasing", label: "Purchase orders", anyOf: ["purchasing.view"] },
      { href: "/admin/purchasing/suppliers", label: "Suppliers", anyOf: ["purchasing.view"] },
      { href: "/admin/purchasing/materials", label: "Materials", anyOf: ["purchasing.view"] },
    ],
  },
  {
    href: "/admin/shipments", label: "Shipping", icon: Truck, anyOf: ["shipments.view"],
    children: [
      { href: "/admin/shipments", label: "Shipments", anyOf: ["shipments.view"] },
      { href: "/admin/shipments/settlements", label: "COD settlements", anyOf: ["finance.view"] },
      { href: "/admin/shipments/couriers", label: "Couriers", anyOf: ["shipments.view"] },
      { href: "/admin/shipments/zones", label: "Delivery zones", anyOf: ["orders.view"] },
    ],
  },
  { href: "/admin/returns", label: "Returns", icon: RotateCcw, anyOf: ["returns.view"] },
  {
    href: "/admin/finance", label: "Finance", icon: Wallet, anyOf: ["finance.view", "payments.view", "expenses.view"],
    children: [
      { href: "/admin/finance", label: "Profit & loss", anyOf: ["finance.view"] },
      { href: "/admin/finance/payments", label: "Payments", anyOf: ["payments.view"] },
      { href: "/admin/finance/refunds", label: "Refunds", anyOf: ["payments.view"] },
      { href: "/admin/finance/expenses", label: "Expenses", anyOf: ["expenses.view"] },
      { href: "/admin/finance/accounts", label: "Accounts", anyOf: ["finance.view"] },
    ],
  },
  { href: "/admin/marketing", label: "Marketing", icon: Megaphone, anyOf: ["marketing.view"] },
  { href: "/admin/reports", label: "Reports", icon: BarChart3, anyOf: ["reports.view"] },
  { href: "/admin/content", label: "Storefront content", icon: Newspaper, anyOf: ["cms.manage"] },
  { href: "/admin/staff", label: "Staff & roles", icon: ShieldCheck, anyOf: ["users.view"] },
  { href: "/admin/audit", label: "Audit log", icon: ClipboardList, anyOf: ["audit.view"] },
  { href: "/admin/settings", label: "Settings", icon: Settings, anyOf: ["settings.view", "couriers.manage", "notifications.manage"] },
];

export const DOCS_LINK = { href: "/api/v1/docs", label: "API docs", icon: FileText };
