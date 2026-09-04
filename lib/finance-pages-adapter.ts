import "server-only";

import type {
  AccountOption,
  AccountsOverviewData,
  TransactionsOverviewData,
} from "@camircode/twofree-ui/portfolio";

import { formatMoneyDto } from "./money";
import { guestAccounts, guestTransactions } from "./guest-data";
import { isGuestMode } from "./guest-mode";
import { serverApiFetch } from "./server-api";

type MoneyDto = Readonly<{ currency: string; coefficient: string; scale: number }>;
type AccountDto = Readonly<{
  id: string;
  type: "debit" | "yield" | "revolving-credit" | "charge-card";
  label: string;
  currency: string;
  metadata: Readonly<Record<string, string>>;
  createdAt: string;
  statementBalance?: MoneyDto;
}>;
type TransactionDto = Readonly<{
  id: string;
  accountId: string;
  amount: MoneyDto;
  metadata: Readonly<Record<string, string>>;
  createdAt: string;
}>;

function decimalText(value: MoneyDto): string {
  const negative = value.coefficient.startsWith("-");
  const digits = negative ? value.coefficient.slice(1) : value.coefficient;
  const padded = digits.padStart(value.scale + 1, "0");
  const point = padded.length - value.scale;
  const decimal = value.scale === 0 ? padded : `${padded.slice(0, point)}.${padded.slice(point)}`;
  return `${negative ? "-" : ""}${decimal}`;
}

async function loadFinanceLists() {
  if (await isGuestMode()) return { accounts: guestAccounts, transactions: guestTransactions };
  const [accountsResult, transactionsResult] = await Promise.all([
    serverApiFetch<{ accounts: readonly AccountDto[] }>("/accounts"),
    serverApiFetch<{ transactions: readonly TransactionDto[] }>("/transactions"),
  ]);
  return { accounts: accountsResult.accounts, transactions: transactionsResult.transactions };
}

export async function loadAccountOptions(): Promise<readonly AccountOption[]> {
  if (await isGuestMode()) {
    return guestAccounts.map(({ id, label, currency }) => ({ id, label, currency }));
  }
  const { accounts } = await serverApiFetch<{ accounts: readonly AccountDto[] }>("/accounts");
  return accounts.map(({ id, label, currency }) => ({ id, label, currency }));
}

export async function loadAccountsOverview(): Promise<AccountsOverviewData> {
  type Profile = Readonly<{
    accountId: string;
    cutoffDay?: number;
    dueDay?: number;
    creditLimit?: MoneyDto;
    creditUsed?: MoneyDto;
    freeTransferCount?: number;
    belowCapAnnualPercent?: string;
    dayBasis?: number;
  }>;
  type ProfileResponse = Readonly<{ records: readonly Readonly<{ value: Profile }>[] }>;
  const guest = await isGuestMode();
  const guestCreditProfiles: ProfileResponse = {
    records: [
      {
        value: {
          accountId: "guest-credit",
          cutoffDay: 15,
          dueDay: 25,
          creditLimit: { currency: "MXN", coefficient: "2500000", scale: 2 },
          creditUsed: { currency: "MXN", coefficient: "684250", scale: 2 },
        },
      },
    ],
  };
  const guestDebitProfiles: ProfileResponse = {
    records: [{ value: { accountId: "guest-debit", freeTransferCount: 5 } }],
  };
  const guestYieldProfiles: ProfileResponse = {
    records: [
      {
        value: {
          accountId: "guest-yield",
          belowCapAnnualPercent: "9.5",
          dayBasis: 360,
        },
      },
    ],
  };
  const [{ accounts, transactions }, creditProfiles, chargeProfiles, debitProfiles, yieldProfiles] =
    await Promise.all([
      loadFinanceLists(),
      guest
        ? Promise.resolve(guestCreditProfiles)
        : serverApiFetch<ProfileResponse>("/credit-cards"),
      guest
        ? Promise.resolve<ProfileResponse>({ records: [] })
        : serverApiFetch<ProfileResponse>("/charge-cards"),
      guest
        ? Promise.resolve(guestDebitProfiles)
        : serverApiFetch<ProfileResponse>("/debit-profiles"),
      guest
        ? Promise.resolve(guestYieldProfiles)
        : serverApiFetch<ProfileResponse>("/yield-accounts"),
    ]);
  const profiles = new Map(
    [
      ...creditProfiles.records,
      ...chargeProfiles.records,
      ...debitProfiles.records,
      ...yieldProfiles.records,
    ].map((record) => [record.value.accountId, record.value]),
  );
  const available = accounts.filter((account) => account.type === "debit").length;
  const invested = accounts.filter((account) => account.type === "yield").length;
  const credit = accounts.filter(
    (account) => account.type === "revolving-credit" || account.type === "charge-card",
  ).length;
  return {
    total: `${accounts.length} cuentas`,
    available: `${available} disponibles`,
    invested: `${invested} con rendimiento`,
    credit: `${credit} de crédito o cargo`,
    accounts: accounts.map((account) => ({
      id: account.id,
      currency: account.currency,
      label: account.label,
      detail:
        account.type === "debit"
          ? "Débito"
          : account.type === "yield"
            ? "Cuenta con rendimiento"
            : account.type === "revolving-credit"
              ? "Crédito revolvente"
              : "Tarjeta de cargo",
      kind:
        account.type === "yield"
          ? "invested"
          : account.type === "revolving-credit" || account.type === "charge-card"
            ? "credit"
            : "available",
      balance: account.statementBalance
        ? `${formatMoneyDto(account.statementBalance).text} ${account.statementBalance.currency}`
        : "Sin saldo registrado",
      accent: (() => {
        const profile = profiles.get(account.id);
        if (!profile) return account.currency;
        if (account.type === "revolving-credit" && profile.creditLimit && profile.creditUsed) {
          const limit = Number(profile.creditLimit.coefficient) / 10 ** profile.creditLimit.scale;
          const used = Number(profile.creditUsed.coefficient) / 10 ** profile.creditUsed.scale;
          return `${limit ? Math.round((used / limit) * 100) : 0}% utilizado · corte ${profile.cutoffDay} · pago ${profile.dueDay}`;
        }
        if (account.type === "charge-card") {
          return `Pago total · corte ${profile.cutoffDay} · pago ${profile.dueDay}`;
        }
        if (account.type === "yield") {
          return `${profile.belowCapAnnualPercent}% hasta el tope · base ${profile.dayBasis}`;
        }
        return `${profile.freeTransferCount ?? 0} transferencias sin comisión`;
      })(),
      statementBalance: account.statementBalance
        ? decimalText(account.statementBalance)
        : undefined,
      transactionCount: transactions.filter((item) => item.accountId === account.id).length,
      type: account.type,
    })),
  };
}

function totalsByCurrency(transactions: readonly TransactionDto[], sign: "income" | "expense") {
  const totals = new Map<string, { coefficient: bigint; scale: number }>();
  for (const transaction of transactions) {
    const coefficient = BigInt(transaction.amount.coefficient);
    if ((sign === "income" && coefficient < 0n) || (sign === "expense" && coefficient >= 0n)) {
      continue;
    }
    const current = totals.get(transaction.amount.currency) ?? { coefficient: 0n, scale: 0 };
    const scale = Math.max(current.scale, transaction.amount.scale);
    const left = current.coefficient * 10n ** BigInt(scale - current.scale);
    const right = coefficient * 10n ** BigInt(scale - transaction.amount.scale);
    totals.set(transaction.amount.currency, { coefficient: left + right, scale });
  }
  if (totals.size === 0) return "Sin movimientos";
  return [...totals.entries()]
    .map(
      ([currency, value]) =>
        `${formatMoneyDto({ currency, coefficient: value.coefficient.toString(), scale: value.scale }).text} ${currency}`,
    )
    .join(" · ");
}

export async function loadTransactionsOverview(): Promise<{
  data: TransactionsOverviewData;
  accounts: readonly AccountOption[];
}> {
  const { accounts, transactions } = await loadFinanceLists();
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  return {
    accounts: accounts.map(({ id, label, currency }) => ({ id, label, currency })),
    data: {
      income: totalsByCurrency(transactions, "income"),
      expenses: totalsByCurrency(transactions, "expense"),
      balance: `${transactions.length} movimientos`,
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        label: transaction.metadata.description || "Movimiento sin descripción",
        account: accountById.get(transaction.accountId)?.label || "Cuenta no disponible",
        category: transaction.metadata.category || "Sin categoría",
        date: new Date(
          `${transaction.metadata.date || transaction.createdAt.slice(0, 10)}T12:00:00`,
        ).toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
        }),
        amount: `${formatMoneyDto(transaction.amount).text} ${transaction.amount.currency}`,
        amountValue: decimalText({
          ...transaction.amount,
          coefficient: transaction.amount.coefficient.replace(/^-/, ""),
        }),
        accountId: transaction.accountId,
        dateIso: transaction.metadata.date || transaction.createdAt.slice(0, 10),
        draft: {
          accountId: transaction.accountId,
          amount: decimalText({
            ...transaction.amount,
            coefficient: transaction.amount.coefficient.replace(/^-/, ""),
          }),
          category: transaction.metadata.category || "",
          date: transaction.metadata.date || transaction.createdAt.slice(0, 10),
          description: transaction.metadata.description || "",
          type: BigInt(transaction.amount.coefficient) >= 0n ? "income" : "expense",
        },
        type: BigInt(transaction.amount.coefficient) >= 0n ? "income" : "expense",
      })),
    },
  };
}
