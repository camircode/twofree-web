import type { TransactionDraft } from "@camircode/twofree-ui/portfolio";

import { browserApiBaseUrl } from "./runtime-api";

type TransactionCommand = Readonly<{
  accountId: string;
  amount: Readonly<{ currency: string; coefficient: string; scale: number }>;
  metadata: Readonly<Record<string, string>>;
}>;

function amountCoefficient(amount: string, type: TransactionDraft["type"]): string {
  const [whole = "0", fraction = ""] = amount.trim().split(".");
  const coefficient = `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  return type === "expense" ? `-${coefficient}` : coefficient;
}

function apiUrl(path: string): URL {
  const configured = browserApiBaseUrl();
  return new URL(path, configured.endsWith("/") ? configured : `${configured}/`);
}

export async function postTransaction(draft: TransactionDraft, currency: string): Promise<void> {
  const body: TransactionCommand = {
    accountId: draft.accountId,
    amount: { currency, coefficient: amountCoefficient(draft.amount, draft.type), scale: 2 },
    metadata: {
      category: draft.category.trim(),
      date: draft.date,
      description: draft.description.trim(),
      type: draft.type,
    },
  };
  const response = await fetch(apiUrl("transactions"), {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (response.ok) return;

  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (response.status === 401) {
    throw new Error("Su sesión no está disponible. Vuelva a iniciar sesión.");
  }
  if (response.status >= 500) {
    throw new Error("No pudimos guardar la transacción. Intente nuevamente en unos momentos.");
  }
  if (response.status === 429) {
    throw new Error("El servicio está ocupado. Espere un momento e intente nuevamente.");
  }
  throw new Error(
    response.status >= 400 && response.status < 500 && payload?.message
      ? payload.message
      : "El servidor rechazó la transacción. Revise los datos e intente nuevamente.",
  );
}
