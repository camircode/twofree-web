"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  ApiProvider,
  type ProductKind,
  type ProductRecord,
} from "@camircode/twofree-data-provider/browser";
import {
  AlertsWorkspace,
  BudgetSavingsWorkspace,
  CardsWorkspace,
  SettingsWorkspace,
  SharedFinancesWorkspace,
  type AlertRuleForm,
  type BudgetForm,
  type CardValue,
  type ChargeCardForm,
  type CollectionState,
  type CreditCardForm,
  type DebitProfileForm,
  type ExpenseValue,
  type GoalValue,
  type GroupValue,
  type ProductRecordView,
  type SharedExpenseForm,
  type SharedGroupForm,
  type YieldAccountForm,
} from "@camircode/twofree-ui/portfolio";

import { browserApiBaseUrl } from "@/lib/runtime-api";

import { AccountSettings } from "./account-settings";

const api = new ApiProvider(browserApiBaseUrl());
const guestTimestamp = "2026-07-24T12:00:00.000Z";
const guestProducts = new Map<ProductKind, ProductRecord<unknown>[]>([
  [
    "budget",
    [
      {
        id: "guest-budget-home",
        kind: "budget",
        value: {
          category: "Alimentos",
          month: "2026-07",
          limit: { currency: "MXN", coefficient: "800000", scale: 2 },
          actual: { currency: "MXN", coefficient: "576000", scale: 2 },
          riskPercent: "80",
          status: "on-track",
          description: "Compras del hogar y despensa",
        },
        createdAt: guestTimestamp,
        updatedAt: guestTimestamp,
      },
    ],
  ],
  [
    "savings-goal",
    [
      {
        id: "guest-goal-emergency",
        kind: "savings-goal",
        value: {
          name: "Fondo de emergencia",
          target: { currency: "MXN", coefficient: "9000000", scale: 2 },
          saved: { currency: "MXN", coefficient: "3825000", scale: 2 },
          targetDate: "2027-02-01",
        },
        createdAt: guestTimestamp,
        updatedAt: guestTimestamp,
      },
    ],
  ],
  [
    "shared-group",
    [
      {
        id: "guest-group-home",
        kind: "shared-group",
        value: {
          name: "Casa",
          members: [
            { userId: "Alex", role: "owner" },
            { userId: "Sam", role: "member" },
          ],
        },
        createdAt: guestTimestamp,
        updatedAt: guestTimestamp,
      },
    ],
  ],
  [
    "shared-expense",
    [
      {
        id: "guest-expense-rent",
        kind: "shared-expense",
        value: {
          groupId: "guest-group-home",
          description: "Renta",
          amount: { currency: "MXN", coefficient: "1400000", scale: 2 },
          paidByUserId: "Alex",
          splits: [
            { userId: "Alex", weight: "1" },
            { userId: "Sam", weight: "1" },
          ],
        },
        createdAt: guestTimestamp,
        updatedAt: guestTimestamp,
      },
    ],
  ],
  [
    "notification-rule",
    [
      {
        id: "guest-alert-budget",
        kind: "notification-rule",
        value: {
          name: "Presupuesto en riesgo",
          source: "budget",
          field: "usagePercent",
          comparator: "gte",
          threshold: "80",
          condition: "budget",
          enabled: true,
        },
        createdAt: guestTimestamp,
        updatedAt: guestTimestamp,
      },
    ],
  ],
]);

function guestList<T>(kind: ProductKind): ProductRecord<T>[] {
  return [...(guestProducts.get(kind) ?? [])] as ProductRecord<T>[];
}

function downloadGuestProducts(): void {
  const envelope = {
    format: "2free-portable",
    version: 2,
    exportedAt: new Date().toISOString(),
    records: [...guestProducts.values()].flat(),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "2free-demo.json";
  link.click();
  URL.revokeObjectURL(url);
}

function recordView<T>(record: ProductRecord<T>): ProductRecordView<T> {
  return {
    id: record.id,
    value: record.value,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function useProducts<T>(kind: ProductKind, guestMode = false) {
  const [state, setState] = useState<CollectionState<T>>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      if (guestMode) {
        setState({ status: "ready", records: guestList<T>(kind).map(recordView), preview: true });
        return;
      }
      const records = await api.list<T>(kind);
      setState({ status: "ready", records: records.map(recordView) });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "No se pudo consultar la API.",
        unauthorized: error instanceof ApiError && error.status === 401,
      });
    }
  }, [guestMode, kind]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("2free:session-changed", refresh);
    return () => window.removeEventListener("2free:session-changed", refresh);
  }, [load]);
  async function create<TInput>(value: TInput) {
    if (guestMode) {
      const records = guestList(kind);
      records.push({
        id: `guest-${crypto.randomUUID()}`,
        kind,
        value,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      guestProducts.set(kind, records);
      await load();
      return;
    }
    await api.create(kind, value);
    await load();
  }
  async function update<TInput>(id: string, value: TInput) {
    if (guestMode) {
      guestProducts.set(
        kind,
        guestList(kind).map((record) =>
          record.id === id ? { ...record, value, updatedAt: new Date().toISOString() } : record,
        ),
      );
      await load();
      return;
    }
    await api.update(kind, id, value);
    await load();
  }
  async function remove(id: string) {
    if (guestMode) {
      guestProducts.set(
        kind,
        guestList(kind).filter((record) => record.id !== id),
      );
      await load();
      return;
    }
    await api.delete(kind, id);
    await load();
  }
  return { state, create, update, remove, refresh: load };
}

export function BudgetPageClient({ guestMode = false }: Readonly<{ guestMode?: boolean }>) {
  const budgets = useProducts<BudgetForm & { status?: "on-track" | "risk" | "exceeded" }>(
    "budget",
    guestMode,
  );
  const goals = useProducts<GoalValue>("savings-goal", guestMode);
  return (
    <BudgetSavingsWorkspace
      budgets={budgets.state}
      goals={goals.state}
      onCreateBudget={budgets.create}
      onCreateGoal={goals.create}
      onUpdateBudget={budgets.update}
      onUpdateGoal={goals.update}
      onDeleteBudget={budgets.remove}
      onDeleteGoal={goals.remove}
    />
  );
}

export function SharedPageClient({ guestMode = false }: Readonly<{ guestMode?: boolean }>) {
  const groups = useProducts<GroupValue>("shared-group", guestMode);
  const expenses = useProducts<ExpenseValue>("shared-expense", guestMode);
  return (
    <SharedFinancesWorkspace
      groups={groups.state}
      expenses={expenses.state}
      onCreateGroup={groups.create as (value: SharedGroupForm) => Promise<void>}
      onCreateExpense={expenses.create as (value: SharedExpenseForm) => Promise<void>}
      onUpdateGroup={groups.update as never}
      onUpdateExpense={expenses.update as never}
      onAddMember={async (groupId, userId) => {
        if (guestMode) return;
        await api.addSharedMember(groupId, userId);
        await groups.refresh();
      }}
      onDeleteGroup={groups.remove}
      onDeleteExpense={expenses.remove}
    />
  );
}

export function CardsPageClient() {
  const credit = useProducts<CardValue>("credit-card");
  const charge = useProducts<CardValue>("charge-card");
  const debit = useProducts<CardValue>("debit-profile");
  const yieldAccounts = useProducts<CardValue>("yield-account");
  return (
    <CardsWorkspace
      creditCards={credit.state}
      chargeCards={charge.state}
      debitProfiles={debit.state}
      yieldAccounts={yieldAccounts.state}
      onCreateCredit={credit.create as (value: CreditCardForm) => Promise<void>}
      onCreateCharge={charge.create as (value: ChargeCardForm) => Promise<void>}
      onCreateDebit={debit.create as (value: DebitProfileForm) => Promise<void>}
      onCreateYield={yieldAccounts.create as (value: YieldAccountForm) => Promise<void>}
      onUpdate={(kind, id, value) =>
        ({
          "credit-card": credit,
          "charge-card": charge,
          "debit-profile": debit,
          "yield-account": yieldAccounts,
        })[kind].update(id, value)
      }
      onDelete={(kind, id) =>
        ({
          "credit-card": credit,
          "charge-card": charge,
          "debit-profile": debit,
          "yield-account": yieldAccounts,
        })[kind].remove(id)
      }
    />
  );
}

export function AlertsPageClient({ guestMode = false }: Readonly<{ guestMode?: boolean }>) {
  const rules = useProducts<AlertRuleForm>("notification-rule", guestMode);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);
  async function requestPermission() {
    if (!("Notification" in window)) return;
    setPermission(await Notification.requestPermission());
  }
  async function evaluate() {
    if (guestMode) return "1 alerta de demostración evaluada. No se envió información.";
    const events = await api.evaluateAlerts({
      budget: { usagePercent: "82" },
      "credit-card": { daysUntilDue: "2" },
      "yield-account": { annualPercent: "7.2" },
    });
    if (Notification.permission === "granted")
      events.forEach(
        (event) =>
          new Notification("2 Free · Alerta financiera", {
            body: `${event.source}.${event.field}: ${event.observed} (umbral ${event.threshold})`,
            tag: event.ruleId,
          }),
      );
    return events.length
      ? `${events.length} alerta${events.length === 1 ? "" : "s"} evaluada${events.length === 1 ? "" : "s"} y mostrada${events.length === 1 ? "" : "s"}.`
      : "La evaluación terminó sin nuevas alertas.";
  }
  return (
    <AlertsWorkspace
      rules={rules.state}
      onCreateRule={rules.create}
      onUpdateRule={rules.update}
      onDeleteRule={rules.remove}
      onEvaluate={evaluate}
      notificationPermission={permission}
      onRequestPermission={requestPermission}
    />
  );
}

export function SettingsPageClient({ guestMode = false }: Readonly<{ guestMode?: boolean }>) {
  async function exportData() {
    if (guestMode) {
      downloadGuestProducts();
      return "La copia de demostración se descargó.";
    }
    const envelope = await api.exportProducts();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `2free-productos-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return "La exportación portable se descargó.";
  }
  async function importData(file: File) {
    if (file.size > 5_000_000) throw new Error("El archivo supera el límite de 5 MB.");
    if (guestMode) return "Archivo validado en la demo. No se guardaron cambios permanentes.";
    await api.importProducts(JSON.parse(await file.text()));
    return "La API validó e importó el respaldo.";
  }
  return (
    <>
      {guestMode ? null : <AccountSettings />}
      <SettingsWorkspace onExport={exportData} onImport={importData} />
    </>
  );
}
