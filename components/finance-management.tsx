"use client";

import { EditPencil, Trash, Xmark } from "iconoir-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  AccountsOverview,
  TransactionsOverview,
  type AccountOption,
  type AccountOverviewItem,
  type AccountsOverviewData,
  type TransactionDraft,
  type TransactionListItem,
  type TransactionsOverviewData,
} from "@camircode/twofree-ui/portfolio";

import {
  deleteAccountRecord,
  deleteTransactionRecord,
  updateAccountRecord,
  updateTransactionRecord,
} from "@/lib/finance-record-api";

import { TransactionRegistration } from "./transaction-registration";

type Feedback = Readonly<{ tone: "error" | "success"; message: string }>;
const guestAccountsKey = "2free-guest-accounts";
const guestTransactionsKey = "2free-guest-transactions";

function readGuestState<T>(key: string): T | undefined {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeGuestState(key: string, value: unknown): void {
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

function accountSummary(accounts: readonly AccountOverviewItem[]): AccountsOverviewData {
  return {
    total: `${accounts.length} cuentas`,
    available: `${accounts.filter((item) => item.type === "debit").length} disponibles`,
    invested: `${accounts.filter((item) => item.type === "yield").length} con rendimiento`,
    credit: `${accounts.filter((item) => item.kind === "credit").length} de crédito o cargo`,
    accounts,
  };
}

function transactionSummary(
  transactions: readonly TransactionListItem[],
  accounts: readonly AccountOption[],
): Pick<TransactionsOverviewData, "balance" | "expenses" | "income"> {
  function total(type: TransactionDraft["type"]): string {
    const values = new Map<string, { coefficient: bigint; scale: number }>();
    for (const transaction of transactions.filter((item) => item.type === type)) {
      const currency =
        accounts.find((item) => item.id === transaction.accountId)?.currency ?? "MXN";
      const [whole = "0", fraction = ""] = transaction.amountValue.split(".");
      const incoming = { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
      const current = values.get(currency) ?? { coefficient: 0n, scale: 0 };
      const scale = Math.max(current.scale, incoming.scale);
      values.set(currency, {
        coefficient:
          current.coefficient * 10n ** BigInt(scale - current.scale) +
          incoming.coefficient * 10n ** BigInt(scale - incoming.scale),
        scale,
      });
    }
    if (values.size === 0) return "Sin movimientos";
    return [...values]
      .map(([currency, value]) => {
        const digits = value.coefficient.toString().padStart(value.scale + 1, "0");
        const point = digits.length - value.scale;
        const whole = new Intl.NumberFormat("es-MX").format(BigInt(digits.slice(0, point)));
        const fraction = value.scale ? digits.slice(point).padEnd(2, "0") : "00";
        const amount = `${whole}.${fraction}`;
        return `$${amount} ${currency}`;
      })
      .join(" · ");
  }
  return {
    balance: `${transactions.length} movimientos`,
    expenses: total("expense"),
    income: total("income"),
  };
}

function RecordButton({
  children,
  danger = false,
  onClick,
}: Readonly<{ children: ReactNode; danger?: boolean; onClick: () => void }>) {
  return (
    <button data-danger={danger || undefined} onClick={onClick} type="button">
      {children}
    </button>
  );
}

export function AccountsManagement({
  action,
  data,
  guestMode,
}: Readonly<{ action: ReactNode; data: AccountsOverviewData; guestMode: boolean }>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [currentData, setCurrentData] = useState(data);
  const [editing, setEditing] = useState<AccountOverviewItem>();
  const [deleting, setDeleting] = useState<AccountOverviewItem>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!guestMode) return;
    const storedAccounts = readGuestState<AccountsOverviewData>(guestAccountsKey);
    const storedTransactions = readGuestState<TransactionsOverviewData>(guestTransactionsKey);
    if (storedAccounts || storedTransactions) {
      setCurrentData((current) => {
        const source = storedAccounts ?? current;
        return storedTransactions
          ? accountSummary(
              source.accounts.map((account) => ({
                ...account,
                transactionCount: storedTransactions.transactions.filter(
                  (transaction) => transaction.accountId === account.id,
                ).length,
              })),
            )
          : source;
      });
    }
    const addAccount = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          currency: string;
          label: string;
          statementBalance: string;
          type: AccountOverviewItem["type"];
        }>
      ).detail;
      const kind =
        detail.type === "yield" ? "invested" : detail.type === "debit" ? "available" : "credit";
      const account: AccountOverviewItem = {
        id: `guest-${crypto.randomUUID()}`,
        accent: detail.currency,
        balance:
          detail.type === "revolving-credit" || detail.type === "charge-card"
            ? `$${detail.statementBalance} ${detail.currency}`
            : "Sin saldo registrado",
        currency: detail.currency,
        detail:
          detail.type === "debit"
            ? "Débito"
            : detail.type === "yield"
              ? "Cuenta con rendimiento"
              : detail.type === "revolving-credit"
                ? "Crédito revolvente"
                : "Tarjeta de cargo",
        kind,
        label: detail.label,
        statementBalance: kind === "credit" ? detail.statementBalance : undefined,
        transactionCount: 0,
        type: detail.type,
      };
      setCurrentData((current) => {
        const next = accountSummary([...current.accounts, account]);
        writeGuestState(guestAccountsKey, next);
        return next;
      });
    };
    window.addEventListener("2free:guest-account-created", addAccount);
    return () => window.removeEventListener("2free:guest-account-created", addAccount);
  }, [guestMode]);

  function open(account: AccountOverviewItem, mode: "edit" | "delete") {
    setFeedback(undefined);
    if (mode === "edit") setEditing(account);
    else setDeleting(account);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
    setEditing(undefined);
    setDeleting(undefined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const values = new FormData(event.currentTarget);
    const label = String(values.get("label") ?? "").trim();
    const statementBalance = String(
      values.get("statementBalance") ?? editing.statementBalance ?? "0",
    );
    if (
      editing.statementBalance !== undefined &&
      !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(statementBalance)
    ) {
      setFeedback({ tone: "error", message: "Ingrese un saldo válido con hasta dos decimales." });
      return;
    }
    setPending(true);
    try {
      if (!guestMode) await updateAccountRecord(editing, label, statementBalance);
      setCurrentData((current) => {
        const next = {
          ...current,
          accounts: current.accounts.map((account) =>
            account.id === editing.id
              ? {
                  ...account,
                  balance:
                    account.statementBalance !== undefined
                      ? `$${statementBalance} ${account.currency}`
                      : account.balance,
                  label,
                  statementBalance,
                }
              : account,
          ),
        };
        if (guestMode) writeGuestState(guestAccountsKey, next);
        return next;
      });
      close();
      if (!guestMode) router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No se pudo actualizar la cuenta.",
      });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!deleting || deleting.transactionCount > 0) return;
    setPending(true);
    try {
      if (!guestMode) await deleteAccountRecord(deleting.id);
      setCurrentData((current) => {
        const next = accountSummary(
          current.accounts.filter((account) => account.id !== deleting.id),
        );
        if (guestMode) writeGuestState(guestAccountsKey, next);
        return next;
      });
      close();
      if (!guestMode) router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No se pudo eliminar la cuenta.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <AccountsOverview
        action={action}
        data={currentData}
        renderActions={(account) => (
          <>
            <RecordButton onClick={() => open(account, "edit")}>
              <EditPencil /> Editar
            </RecordButton>
            <RecordButton danger onClick={() => open(account, "delete")}>
              <Trash /> Eliminar
            </RecordButton>
          </>
        )}
      />
      <dialog
        aria-labelledby="account-record-dialog-title"
        className="ui-transaction-dialog finance-record-dialog"
        ref={dialogRef}
        onClose={() => {
          setEditing(undefined);
          setDeleting(undefined);
        }}
      >
        <div className="ui-transaction-dialog__top">
          <div>
            <h2 id="account-record-dialog-title">
              {editing ? "Editar cuenta" : "Eliminar cuenta"}
            </h2>
          </div>
          <button aria-label="Cerrar" onClick={close} type="button">
            <Xmark />
          </button>
        </div>
        {editing ? (
          <form onSubmit={submit}>
            <label>
              Nombre
              <input autoFocus defaultValue={editing.label} maxLength={80} name="label" required />
            </label>
            <label>
              Moneda
              <input disabled value={editing.currency} />
            </label>
            {editing.statementBalance !== undefined ? (
              <label>
                Saldo actual
                <input
                  defaultValue={editing.statementBalance}
                  inputMode="decimal"
                  name="statementBalance"
                  required
                />
              </label>
            ) : null}
            {feedback ? (
              <p data-tone={feedback.tone} role="alert">
                {feedback.message}
              </p>
            ) : null}
            <div className="ui-transaction-dialog__actions">
              <button onClick={close} type="button">
                Cancelar
              </button>
              <button
                className="ui-portfolio__button ui-portfolio__button--dark"
                disabled={pending}
                type="submit"
              >
                {pending ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </form>
        ) : deleting ? (
          <div className="finance-record-dialog__confirmation">
            <p>
              {deleting.transactionCount > 0
                ? `Esta cuenta tiene ${deleting.transactionCount} movimiento${deleting.transactionCount === 1 ? "" : "s"}. Elimine primero las transacciones asociadas.`
                : `Se eliminará “${deleting.label}”. Esta acción no se puede deshacer.`}
            </p>
            {deleting.transactionCount > 0 ? (
              <a href={`/transacciones?cuenta=${deleting.id}`}>Ver movimientos asociados</a>
            ) : null}
            {feedback ? (
              <p data-tone={feedback.tone} role="alert">
                {feedback.message}
              </p>
            ) : null}
            <div className="ui-transaction-dialog__actions">
              <button onClick={close} type="button">
                Cancelar
              </button>
              <button
                className="ui-portfolio__button ui-portfolio__button--dark"
                disabled={pending || deleting.transactionCount > 0}
                onClick={remove}
                type="button"
              >
                {pending ? "Eliminando..." : "Eliminar cuenta"}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

export function TransactionsManagement({
  accounts,
  data,
  guestMode,
  registrationAction,
}: Readonly<{
  accounts: readonly AccountOption[];
  data: TransactionsOverviewData;
  guestMode: boolean;
  registrationAction: ReactNode;
}>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [currentData, setCurrentData] = useState(data);
  const [localAccounts, setLocalAccounts] = useState(accounts);
  const [editing, setEditing] = useState<TransactionListItem>();
  const [deleting, setDeleting] = useState<TransactionListItem>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!guestMode) return;
    const stored = readGuestState<TransactionsOverviewData>(guestTransactionsKey);
    const storedAccounts = readGuestState<AccountsOverviewData>(guestAccountsKey);
    if (stored) setCurrentData(stored);
    if (storedAccounts) {
      setLocalAccounts(
        storedAccounts.accounts.map(({ id, label, currency }) => ({ id, label, currency })),
      );
    }
    const addTransaction = (event: Event) => {
      const { account, draft } = (
        event as CustomEvent<{ account: AccountOption; draft: TransactionDraft }>
      ).detail;
      const item: TransactionListItem = {
        id: `guest-${crypto.randomUUID()}`,
        account: account.label,
        accountId: account.id,
        amount: `${draft.type === "expense" ? "-" : ""}$${draft.amount} ${account.currency}`,
        amountValue: draft.amount,
        category: draft.category,
        date: new Date(`${draft.date}T12:00:00`).toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
        }),
        dateIso: draft.date,
        draft,
        label: draft.description,
        type: draft.type,
      };
      setCurrentData((current) => {
        const transactions = [item, ...current.transactions];
        const next = {
          ...current,
          ...transactionSummary(transactions, localAccounts),
          transactions,
        };
        writeGuestState(guestTransactionsKey, next);
        return next;
      });
    };
    window.addEventListener("2free:guest-transaction-created", addTransaction);
    return () => window.removeEventListener("2free:guest-transaction-created", addTransaction);
  }, [accounts, guestMode, localAccounts]);

  function open(item: TransactionListItem, mode: "edit" | "delete") {
    setFeedback(undefined);
    if (mode === "edit") setEditing(item);
    else setDeleting(item);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
    setEditing(undefined);
    setDeleting(undefined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const values = new FormData(event.currentTarget);
    const draft: TransactionDraft = {
      accountId: String(values.get("accountId")),
      type: String(values.get("type")) as TransactionDraft["type"],
      amount: String(values.get("amount")),
      date: String(values.get("date")),
      category: String(values.get("category")),
      description: String(values.get("description")),
    };
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(draft.amount)) {
      setFeedback({ tone: "error", message: "Ingrese un monto válido con hasta dos decimales." });
      return;
    }
    const account = localAccounts.find((item) => item.id === draft.accountId);
    if (!account)
      return setFeedback({
        tone: "error",
        message: "La cuenta seleccionada ya no está disponible.",
      });
    setPending(true);
    try {
      if (!guestMode) await updateTransactionRecord(editing.id, draft, account.currency);
      setCurrentData((current) => {
        const transactions = current.transactions.map((item) =>
          item.id === editing.id
            ? {
                ...item,
                account: account.label,
                accountId: account.id,
                amount: `${draft.type === "expense" ? "-" : ""}$${draft.amount} ${account.currency}`,
                amountValue: draft.amount,
                category: draft.category,
                date: new Date(`${draft.date}T12:00:00`).toLocaleDateString("es-MX", {
                  day: "2-digit",
                  month: "short",
                }),
                dateIso: draft.date,
                draft,
                label: draft.description,
                type: draft.type,
              }
            : item,
        );
        const next = {
          ...current,
          ...transactionSummary(transactions, localAccounts),
          transactions,
        };
        if (guestMode) writeGuestState(guestTransactionsKey, next);
        return next;
      });
      close();
      if (!guestMode) router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No se pudo actualizar el movimiento.",
      });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setPending(true);
    try {
      if (!guestMode) await deleteTransactionRecord(deleting.id);
      setCurrentData((current) => {
        const transactions = current.transactions.filter((item) => item.id !== deleting.id);
        const next = {
          ...current,
          ...transactionSummary(transactions, localAccounts),
          transactions,
        };
        if (guestMode) writeGuestState(guestTransactionsKey, next);
        return next;
      });
      close();
      if (!guestMode) router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No se pudo eliminar el movimiento.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <TransactionsOverview
        data={currentData}
        registrationAction={
          guestMode ? (
            <TransactionRegistration accounts={localAccounts} guestMode />
          ) : (
            registrationAction
          )
        }
        renderActions={(item) => (
          <>
            <RecordButton onClick={() => open(item, "edit")}>
              <EditPencil /> Editar
            </RecordButton>
            <RecordButton danger onClick={() => open(item, "delete")}>
              <Trash /> Eliminar
            </RecordButton>
          </>
        )}
      />
      <dialog
        aria-labelledby="transaction-record-dialog-title"
        className="ui-transaction-dialog finance-record-dialog"
        ref={dialogRef}
        onClose={() => {
          setEditing(undefined);
          setDeleting(undefined);
        }}
      >
        <div className="ui-transaction-dialog__top">
          <div>
            <h2 id="transaction-record-dialog-title">
              {editing ? "Editar movimiento" : "Eliminar movimiento"}
            </h2>
          </div>
          <button aria-label="Cerrar" onClick={close} type="button">
            <Xmark />
          </button>
        </div>
        {editing ? (
          <form onSubmit={submit}>
            <div className="ui-transaction-dialog__grid">
              <label>
                Cuenta
                <select defaultValue={editing.draft.accountId} name="accountId">
                  {localAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo
                <select defaultValue={editing.draft.type} name="type">
                  <option value="expense">Gasto</option>
                  <option value="income">Ingreso</option>
                </select>
              </label>
              <label>
                Monto
                <input
                  defaultValue={editing.draft.amount}
                  inputMode="decimal"
                  name="amount"
                  required
                />
              </label>
              <label>
                Fecha
                <input defaultValue={editing.draft.date} name="date" required type="date" />
              </label>
              <label>
                Categoría
                <input
                  defaultValue={editing.draft.category}
                  maxLength={80}
                  name="category"
                  required
                />
              </label>
              <label>
                Descripción
                <input
                  defaultValue={editing.draft.description}
                  maxLength={120}
                  name="description"
                  required
                />
              </label>
            </div>
            {feedback ? (
              <p data-tone={feedback.tone} role="alert">
                {feedback.message}
              </p>
            ) : null}
            <div className="ui-transaction-dialog__actions">
              <button onClick={close} type="button">
                Cancelar
              </button>
              <button
                className="ui-portfolio__button ui-portfolio__button--dark"
                disabled={pending}
                type="submit"
              >
                {pending ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </form>
        ) : deleting ? (
          <div className="finance-record-dialog__confirmation">
            <p>
              Se eliminará “{deleting.label}” por {deleting.amount}. Esta acción no se puede
              deshacer.
            </p>
            {feedback ? (
              <p data-tone={feedback.tone} role="alert">
                {feedback.message}
              </p>
            ) : null}
            <div className="ui-transaction-dialog__actions">
              <button onClick={close} type="button">
                Cancelar
              </button>
              <button
                className="ui-portfolio__button ui-portfolio__button--dark"
                disabled={pending}
                onClick={remove}
                type="button"
              >
                {pending ? "Eliminando..." : "Eliminar movimiento"}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
