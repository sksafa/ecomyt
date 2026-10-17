// Single source of truth for permission keys. Seeded into the Permission table;
// routes reference these keys and the backend enforces them on every request.
export const PERMISSIONS = {
  // dashboard & finance visibility
  "dashboard.view": "View operational dashboard",
  "finance.view": "View revenue, cost, margin and profit figures",

  // orders
  "orders.view": "View orders",
  "orders.create": "Create orders",
  "orders.edit": "Edit order details and items",
  "orders.confirm": "Confirm or reject orders",
  "orders.cancel": "Cancel orders",
  "orders.status": "Change order status (permitted transitions)",
  "orders.assign": "Assign orders to staff",
  "orders.export": "Export orders",
  "orders.bulk": "Run bulk order actions",
  "orders.override_delivery": "Override delivery charges",

  // customers
  "customers.view": "View customers",
  "customers.edit": "Create and edit customers",
  "customers.delete": "Delete / anonymise customers",
  "customers.export": "Export customer data",

  // catalog & stock
  "products.view": "View products",
  "products.manage": "Create, edit and archive products",
  "inventory.view": "View stock levels and movements",
  "inventory.adjust": "Adjust stock",
  "purchasing.view": "View suppliers and purchase orders",
  "purchasing.manage": "Manage suppliers, purchase orders and receiving",

  // shipping & couriers
  "shipments.view": "View shipments and tracking",
  "shipments.book": "Book courier shipments",
  "shipments.cancel": "Cancel courier shipments",
  "couriers.manage": "Manage courier providers and credentials",
  "shipping.manage": "Manage delivery zones, rates and pickup addresses",

  // returns & money
  "returns.view": "View returns and exchanges",
  "returns.manage": "Create and process returns / exchanges",
  "returns.approve": "Approve or reject returns",
  "refunds.approve": "Approve and pay refunds",
  "payments.view": "View payments",
  "payments.record": "Record and verify payments",
  "expenses.view": "View expenses",
  "expenses.manage": "Create and edit expenses",
  "accounts.reconcile": "Reconcile COD settlements and manual adjustments",

  // reporting & marketing
  "reports.view": "View reports",
  "reports.export": "Export reports",
  "marketing.view": "View marketing attribution and ad performance",
  "marketing.manage": "Import ad spend and manage marketing settings",

  // content & system
  "cms.manage": "Manage storefront content",
  "notifications.manage": "Manage notification templates and channels",
  "settings.view": "View settings",
  "settings.manage": "Change system settings",
  "users.view": "View staff accounts",
  "users.manage": "Create and manage staff accounts",
  "roles.manage": "Create roles and assign permissions",
  "audit.view": "View audit and login logs",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const ops = (...keys: Permission[]) => keys;

// Least-privilege defaults. Super Admin implicitly has every permission.
export const DEFAULT_ROLES: Record<string, { name: string; description: string; permissions: Permission[] }> = {
  super_admin: { name: "Super Admin", description: "Full access including roles and credentials", permissions: ALL_PERMISSIONS },
  admin: {
    name: "Admin",
    description: "Runs the business; cannot manage roles",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "roles.manage"),
  },
  order_manager: {
    name: "Order Manager",
    description: "Owns the order pipeline end to end",
    permissions: ops(
      "dashboard.view", "orders.view", "orders.create", "orders.edit", "orders.confirm", "orders.cancel",
      "orders.status", "orders.assign", "orders.export", "orders.bulk", "orders.override_delivery",
      "customers.view", "customers.edit", "products.view", "inventory.view", "shipments.view",
      "shipments.book", "shipments.cancel", "returns.view", "returns.manage", "payments.view", "reports.view",
    ),
  },
  confirmation_agent: {
    name: "Order Confirmation Agent",
    description: "Calls customers and confirms or cancels new orders",
    permissions: ops("orders.view", "orders.create", "orders.edit", "orders.confirm", "orders.cancel", "customers.view", "customers.edit", "products.view"),
  },
  customer_support: {
    name: "Customer Support",
    description: "Answers customers, logs communication, opens returns",
    permissions: ops("orders.view", "customers.view", "customers.edit", "products.view", "shipments.view", "returns.view", "returns.manage"),
  },
  warehouse: {
    name: "Warehouse Staff",
    description: "Packs orders, manages stock and inspects returns",
    permissions: ops("orders.view", "orders.status", "products.view", "inventory.view", "inventory.adjust", "purchasing.view", "shipments.view", "returns.view", "returns.manage"),
  },
  courier_manager: {
    name: "Courier Manager",
    description: "Books and tracks shipments, manages courier settings",
    permissions: ops("orders.view", "orders.status", "shipments.view", "shipments.book", "shipments.cancel", "couriers.manage", "shipping.manage", "returns.view"),
  },
  accountant: {
    name: "Accountant",
    description: "Payments, expenses, settlements and financial reports",
    permissions: ops(
      "dashboard.view", "finance.view", "orders.view", "payments.view", "payments.record", "refunds.approve",
      "expenses.view", "expenses.manage", "accounts.reconcile", "purchasing.view", "shipments.view",
      "returns.view", "reports.view", "reports.export",
    ),
  },
  marketing_manager: {
    name: "Marketing Manager",
    description: "Campaign attribution, ad spend and storefront content",
    permissions: ops("dashboard.view", "orders.view", "products.view", "marketing.view", "marketing.manage", "reports.view", "cms.manage"),
  },
  analyst: {
    name: "Read-only Analyst",
    description: "Read-only access to dashboards and reports",
    permissions: ops("dashboard.view", "finance.view", "orders.view", "customers.view", "products.view", "inventory.view", "shipments.view", "returns.view", "reports.view", "marketing.view"),
  },
};

export const permissionModule = (key: string) => key.split(".")[0];
