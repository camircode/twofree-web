"use client";

import {
  TransactionComposer,
  type AccountOption,
  type TransactionDraft,
  type TransactionSubmitResult,
} from "@camircode/twofree-ui/portfolio";
import { useRouter } from "next/navigation";

import { postTransaction } from "@/lib/transaction-api";

export function TransactionRegistration({
  accounts,
  compact = false,
  guestMode = false,
  initialType = "expense",
  triggerLabel,
}: {
  accounts: readonly AccountOption[];
  compact?: boolean;
  guestMode?: boolean;
  initialType?: TransactionDraft["type"];
  triggerLabel?: string;
}) {
  const router = useRouter();

  async function submit(draft: TransactionDraft): Promise<TransactionSubmitResult> {
    const account = accounts.find((item) => item.id === draft.accountId);
    if (!account)
      return { status: "error", message: "La cuenta seleccionada ya no está disponible." };
    try {
      if (guestMode) {
        window.dispatchEvent(
          new CustomEvent("2free:guest-transaction-created", { detail: { account, draft } }),
        );
        return {
          status: "success",
          message: "Movimiento simulado. Los datos de la demo no se guardan.",
        };
      }
      await postTransaction(draft, account.currency);
      router.refresh();
      return { status: "success", message: "La transacción se registró correctamente." };
    } catch (error) {
      return {
        status: "error",
        message:
          error instanceof TypeError
            ? "No fue posible conectar con la API. Sus datos siguen en el formulario para volver a intentar."
            : error instanceof Error
              ? error.message
              : "No pudimos registrar la transacción.",
      };
    }
  }

  return (
    <TransactionComposer
      accounts={accounts}
      compactTrigger={compact}
      initialType={initialType}
      onSubmit={submit}
      triggerLabel={triggerLabel}
    />
  );
}
