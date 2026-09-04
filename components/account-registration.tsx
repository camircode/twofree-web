"use client";

import { ArrowLeft, ArrowRight, Check, Plus, Xmark } from "iconoir-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { browserApiBaseUrl } from "@/lib/runtime-api";

type AccountType = "debit" | "yield" | "revolving-credit" | "charge-card";

const accountTypes: readonly Readonly<{
  value: AccountType;
  label: string;
  description: string;
}>[] = [
  { value: "debit", label: "Débito", description: "Retiros, pagos y transferencias." },
  {
    value: "yield",
    label: "Cuenta con rendimiento",
    description: "Saldo a la vista con tasas y tope configurables.",
  },
  {
    value: "revolving-credit",
    label: "Tarjeta de crédito",
    description: "Línea revolvente, CAT, intereses y comisiones.",
  },
  {
    value: "charge-card",
    label: "Tarjeta de servicio",
    description: "Pago total obligatorio y cargo por atraso.",
  },
];

function money(value: FormDataEntryValue | null, currency: string) {
  const normalized = String(value ?? "0").trim();
  const [whole = "0", fraction = ""] = normalized.split(".");
  return {
    currency,
    coefficient: `${whole}${fraction}`.replace(/^0+(?=\d)/u, "") || "0",
    scale: fraction.length,
  };
}

async function post(path: string, body: unknown) {
  const response = await fetch(new URL(path, browserApiBaseUrl()), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    account?: { id: string };
    message?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.message ?? "No se pudo guardar la configuración.");
  return payload;
}

export function AccountRegistration({ guestMode = false }: Readonly<{ guestMode?: boolean }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [type, setType] = useState<AccountType>("debit");
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");

  function openDialog() {
    setStep(1);
    setError("");
    setClosing(false);
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (!dialogRef.current?.open || closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialogRef.current.close();
      return;
    }
    setClosing(true);
    window.setTimeout(() => {
      dialogRef.current?.close();
      setClosing(false);
    }, 180);
  }

  function nextStep(form: HTMLFormElement) {
    const fields = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        ".account-wizard__step:not([hidden]) input, .account-wizard__step:not([hidden]) select",
      ),
    );
    if (fields.every((field) => field.reportValidity())) {
      setStep((current) => current + 1);
    }
  }

  useEffect(() => {
    if (searchParams.get("crear") === "1") openDialog();
  }, [searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currency = String(data.get("currency") ?? "MXN").toUpperCase();
    setPending(true);
    setError("");
    try {
      if (guestMode) {
        window.dispatchEvent(
          new CustomEvent("2free:guest-account-created", {
            detail: {
              currency,
              label: String(data.get("label") ?? "").trim(),
              statementBalance: String(data.get("statementBalance") ?? "0.00"),
              type,
            },
          }),
        );
        form.reset();
        closeDialog();
        return;
      }
      const accountPayload = await post("accounts", {
        type,
        label: String(data.get("label") ?? "").trim(),
        currency,
        metadata: {},
        ...(type === "revolving-credit" || type === "charge-card"
          ? { statementBalance: money(data.get("statementBalance"), currency) }
          : {}),
      });
      const accountId = accountPayload?.account?.id;
      if (!accountId) throw new Error("La API no devolvió la cuenta creada.");

      const transferProfile = {
        accountId,
        freeTransferCount: Number(data.get("freeTransferCount")),
        freeTransferAmount: money(data.get("freeTransferAmount"), currency),
        excessTransferFee: money(data.get("excessTransferFee"), currency),
      };
      if (type === "debit" || type === "yield") {
        await post("debit-profiles", transferProfile);
      }
      if (type === "yield") {
        await post("yield-accounts", {
          accountId,
          investmentCap: money(data.get("investmentCap"), currency),
          belowCapAnnualPercent: String(data.get("belowRate")),
          aboveCapAnnualPercent: String(data.get("aboveRate")),
          dayBasis: Number(data.get("dayBasis")),
        });
      }
      if (type === "revolving-credit") {
        const creditLimit = money(data.get("creditLimit"), currency);
        const warningDays = Number(data.get("minimumUseWarningDays"));
        await post("credit-cards", {
          accountId,
          cutoffDay: Number(data.get("cutoffDay")),
          dueDay: Number(data.get("dueDay")),
          catAnnualPercent: String(data.get("cat")),
          annualInterestPercent: String(data.get("interest")),
          annualFee: money(data.get("annualFee"), currency),
          minimumUseFee: money(data.get("minimumUseFee"), currency),
          minimumUseThreshold: money(data.get("minimumUseThreshold"), currency),
          minimumUsePeriod: String(data.get("minimumUsePeriod")),
          minimumUseWarningDays: warningDays,
          creditLimit,
          creditUsed: money(data.get("creditUsed"), currency),
          limitHistory: [
            {
              effectiveAt: new Date(
                `${String(data.get("creditLimitDate"))}T12:00:00Z`,
              ).toISOString(),
              limit: creditLimit,
            },
          ],
          movements: [],
        });
        await post("notification-rules", {
          name: `Uso mínimo de ${String(data.get("label"))}`,
          source: `credit-card:${accountId}`,
          field: "daysUntilMinimumUseFee",
          comparator: "lte",
          threshold: String(warningDays),
          condition: "card",
          enabled: true,
        });
      }
      if (type === "charge-card") {
        await post("charge-cards", {
          accountId,
          cutoffDay: Number(data.get("cutoffDay")),
          dueDay: Number(data.get("dueDay")),
          annualFee: money(data.get("annualFee"), currency),
          lateFee: money(data.get("lateFee"), currency),
          fullStatementPaymentRequired: true,
          movements: [],
        });
      }

      form.reset();
      closeDialog();
      router.replace("/cuentas");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo crear la cuenta.");
    } finally {
      setPending(false);
    }
  }

  const selectedType = accountTypes.find((item) => item.value === type) ?? accountTypes[0];

  return (
    <>
      <button
        className="ui-portfolio__button ui-portfolio__button--dark"
        onClick={openDialog}
        type="button"
      >
        <Plus /> Crear una cuenta
      </button>
      <dialog
        aria-labelledby="account-registration-title"
        className="ui-transaction-dialog account-wizard"
        data-closing={closing || undefined}
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        ref={dialogRef}
      >
        <div className="ui-transaction-dialog__top">
          <div>
            <span className="account-wizard__progress">Paso {step} de 4</span>
            <h2 id="account-registration-title">Crear una cuenta</h2>
          </div>
          <button aria-label="Cerrar" onClick={closeDialog} type="button">
            <Xmark />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="account-wizard__step" hidden={step !== 1}>
            <h3>¿Qué desea registrar?</h3>
            <div className="account-wizard__types">
              {accountTypes.map((item) => (
                <button
                  aria-pressed={type === item.value}
                  key={item.value}
                  onClick={() => setType(item.value)}
                  type="button"
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                  {type === item.value ? <Check aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="account-wizard__step" hidden={step !== 2}>
            <h3>Datos de la cuenta</h3>
            <div className="ui-transaction-dialog__grid">
              <label>
                Nombre
                <input maxLength={80} name="label" required />
              </label>
              <label>
                Moneda
                <input defaultValue="MXN" maxLength={8} name="currency" required />
              </label>
              {type === "revolving-credit" || type === "charge-card" ? (
                <label>
                  Saldo actual
                  <input defaultValue="0.00" inputMode="decimal" name="statementBalance" required />
                </label>
              ) : null}
            </div>
          </div>

          <div className="account-wizard__step" hidden={step !== 3}>
            <h3>Condiciones de {selectedType.label.toLocaleLowerCase("es")}</h3>
            {type === "debit" || type === "yield" ? (
              <div className="ui-transaction-dialog__grid">
                <label>
                  Transferencias gratuitas
                  <input defaultValue="0" min="0" name="freeTransferCount" required type="number" />
                </label>
                <label>
                  Monto gratuito de transferencias
                  <input
                    defaultValue="0.00"
                    inputMode="decimal"
                    name="freeTransferAmount"
                    required
                  />
                </label>
                <label>
                  Comisión al exceder el límite
                  <input
                    defaultValue="0.00"
                    inputMode="decimal"
                    name="excessTransferFee"
                    required
                  />
                </label>
                {type === "yield" ? (
                  <>
                    <label>
                      Tope de inversión
                      <input inputMode="decimal" name="investmentCap" required />
                    </label>
                    <label>
                      Tasa hasta el tope (%)
                      <input inputMode="decimal" name="belowRate" required />
                    </label>
                    <label>
                      Tasa después del tope (%)
                      <input inputMode="decimal" name="aboveRate" required />
                    </label>
                    <label>
                      Base anual
                      <select name="dayBasis">
                        <option value="360">360 días</option>
                        <option value="365">365 días</option>
                      </select>
                    </label>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="ui-transaction-dialog__grid">
                <label>
                  Día de corte
                  <input max="31" min="1" name="cutoffDay" required type="number" />
                </label>
                <label>
                  Día límite de pago
                  <input max="31" min="1" name="dueDay" required type="number" />
                </label>
                <label>
                  Anualidad
                  <input defaultValue="0.00" inputMode="decimal" name="annualFee" required />
                </label>
                {type === "charge-card" ? (
                  <label>
                    Cargo por pago tardío
                    <input defaultValue="0.00" inputMode="decimal" name="lateFee" required />
                  </label>
                ) : (
                  <>
                    <label>
                      CAT anual (%)
                      <input inputMode="decimal" name="cat" required />
                    </label>
                    <label>
                      Tasa de interés anual (%)
                      <input inputMode="decimal" name="interest" required />
                    </label>
                    <label>
                      Línea de crédito
                      <input inputMode="decimal" name="creditLimit" required />
                    </label>
                    <label>
                      Línea utilizada
                      <input defaultValue="0.00" inputMode="decimal" name="creditUsed" required />
                    </label>
                    <label>
                      Vigencia de la línea actual
                      <input name="creditLimitDate" required type="date" />
                    </label>
                    <label>
                      Monto mínimo de uso
                      <input
                        defaultValue="0.00"
                        inputMode="decimal"
                        name="minimumUseThreshold"
                        required
                      />
                    </label>
                    <label>
                      Comisión por uso insuficiente
                      <input
                        defaultValue="0.00"
                        inputMode="decimal"
                        name="minimumUseFee"
                        required
                      />
                    </label>
                    <label>
                      Periodo del uso mínimo
                      <select name="minimumUsePeriod">
                        <option value="monthly">Mensual</option>
                        <option value="annual">Anual</option>
                      </select>
                    </label>
                    <label>
                      Advertir con anticipación
                      <select name="minimumUseWarningDays">
                        <option value="3">3 días antes</option>
                        <option value="5">5 días antes</option>
                        <option value="7">7 días antes</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="account-wizard__step account-wizard__review" hidden={step !== 4}>
            <h3>Revise antes de crear</h3>
            <dl>
              <div>
                <dt>Tipo</dt>
                <dd>{selectedType.label}</dd>
              </div>
              <div>
                <dt>Movimientos</dt>
                <dd>Se registrarán desde Transacciones</dd>
              </div>
            </dl>
          </div>

          {error ? (
            <p className="account-wizard__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="ui-transaction-dialog__actions">
            {step > 1 ? (
              <button onClick={() => setStep((current) => current - 1)} type="button">
                <ArrowLeft /> Anterior
              </button>
            ) : (
              <button onClick={closeDialog} type="button">
                Cancelar
              </button>
            )}
            {step < 4 ? (
              <button
                className="ui-portfolio__button ui-portfolio__button--dark"
                onClick={(event) => nextStep(event.currentTarget.form!)}
                type="button"
              >
                Continuar <ArrowRight />
              </button>
            ) : (
              <button
                className="ui-portfolio__button ui-portfolio__button--dark"
                disabled={pending}
                type="submit"
              >
                {pending ? "Creando..." : "Crear cuenta"}
              </button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}
