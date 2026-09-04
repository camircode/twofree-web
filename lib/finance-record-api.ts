import type { AccountOverviewItem, TransactionDraft } from "@camircode/twofree-ui/portfolio";

import { browserApiBaseUrl } from "./runtime-api";

function money(value: string, currency: string, negative = false) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(value.trim())) {
    throw new Error("Ingrese un monto válido con hasta dos decimales.");
  }
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const coefficient = `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/u, "") || "0";
  return { currency, coefficient: negative ? `-${coefficient}` : coefficient, scale: 2 };
}

async function mutate(path: string, method: "DELETE" | "PATCH", body?: unknown): Promise<void> {
  const response = await fetch(new URL(path, browserApiBaseUrl()), {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (payload?.message === "delete associated transactions before deleting the account") {
    throw new Error("Elimine primero los movimientos asociados a esta cuenta.");
  }
  throw new Error(payload?.message || "No se pudo completar el cambio.");
}

export function updateAccountRecord(account: AccountOverviewItem, label: string, balance: string) {
  return mutate(`accounts/${encodeURIComponent(account.id)}`, "PATCH", {
    type: account.type,
    label: label.trim(),
    currency: account.currency,
    metadata: {},
    ...(account.type === "revolving-credit" || account.type === "charge-card"
      ? { statementBalance: money(balance, account.currency) }
      : {}),
  });
}

export function deleteAccountRecord(id: string) {
  return mutate(`accounts/${encodeURIComponent(id)}`, "DELETE");
}

export function updateTransactionRecord(id: string, draft: TransactionDraft, currency: string) {
  return mutate(`transactions/${encodeURIComponent(id)}`, "PATCH", {
    accountId: draft.accountId,
    amount: money(draft.amount, currency, draft.type === "expense"),
    metadata: {
      category: draft.category.trim(),
      date: draft.date,
      description: draft.description.trim(),
      type: draft.type,
    },
  });
}

export function deleteTransactionRecord(id: string) {
  return mutate(`transactions/${encodeURIComponent(id)}`, "DELETE");
}
