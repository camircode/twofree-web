import type { DashboardApiResponse } from "./dashboard-adapter";

type GuestMoney = Readonly<{ currency: string; coefficient: string; scale: number }>;
type GuestAccount = Readonly<{
  id: string;
  type: "debit" | "yield" | "revolving-credit" | "charge-card";
  label: string;
  currency: string;
  metadata: Readonly<Record<string, string>>;
  statementBalance?: GuestMoney;
  createdAt: string;
}>;
type GuestTransaction = Readonly<{
  id: string;
  accountId: string;
  amount: GuestMoney;
  metadata: Readonly<Record<string, string>>;
  createdAt: string;
}>;

export const guestAccounts: readonly GuestAccount[] = [
  {
    id: "guest-debit",
    type: "debit",
    label: "Cuenta diaria",
    currency: "MXN",
    metadata: {},
    createdAt: "2026-07-01T12:00:00.000Z",
  },
  {
    id: "guest-yield",
    type: "yield",
    label: "Fondo de tranquilidad",
    currency: "MXN",
    metadata: {},
    createdAt: "2026-07-02T12:00:00.000Z",
  },
  {
    id: "guest-credit",
    type: "revolving-credit",
    label: "Tarjeta principal",
    currency: "MXN",
    metadata: {},
    statementBalance: { currency: "MXN", coefficient: "684250", scale: 2 },
    createdAt: "2026-07-03T12:00:00.000Z",
  },
] as const;

export const guestTransactions: readonly GuestTransaction[] = [
  {
    id: "guest-transaction-1",
    accountId: "guest-debit",
    amount: { currency: "MXN", coefficient: "4500000", scale: 2 },
    metadata: { category: "Ingresos", description: "Ingreso mensual", type: "income" },
    createdAt: "2026-07-24T12:00:00.000Z",
  },
  {
    id: "guest-transaction-2",
    accountId: "guest-credit",
    amount: { currency: "MXN", coefficient: "-128050", scale: 2 },
    metadata: { category: "Hogar", description: "Supermercado", type: "expense" },
    createdAt: "2026-07-23T12:00:00.000Z",
  },
  {
    id: "guest-transaction-3",
    accountId: "guest-debit",
    amount: { currency: "MXN", coefficient: "-85000", scale: 2 },
    metadata: { category: "Servicios", description: "Internet", type: "expense" },
    createdAt: "2026-07-21T12:00:00.000Z",
  },
] as const;

export const guestDashboard: DashboardApiResponse = {
  accountCount: guestAccounts.length,
  transactionCount: guestTransactions.length,
  accounts: guestAccounts,
  transactions: guestTransactions,
  totals: [{ currency: "MXN", coefficient: "4281950", scale: 2 }],
};
