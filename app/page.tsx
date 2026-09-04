import Link from "next/link";

import { FinanceDashboard, type DashboardState } from "@camircode/twofree-ui";
import type { AccountOption } from "@camircode/twofree-ui/portfolio";
import { Wallet } from "iconoir-react";
import { HomeGreeting } from "@/components/home-greeting";
import { OpenAuthButton } from "@/components/open-auth-button";
import { TransactionRegistration } from "@/components/transaction-registration";
import { loadDashboardPage } from "@/lib/dashboard-adapter";
import { isGuestMode } from "@/lib/guest-mode";

export const dynamic = "force-dynamic";

function HomeActions({
  state,
  accounts,
  guestMode,
}: Readonly<{ state: DashboardState; accounts: readonly AccountOption[]; guestMode: boolean }>) {
  if (state.status === "locked") {
    return (
      <div className="web-home__access">
        <p>Inicie sesión para consultar y registrar sus movimientos.</p>
        <OpenAuthButton>Iniciar sesión</OpenAuthButton>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="web-home__access">
        <p>No pudimos consultar su espacio financiero.</p>
        <Link className="web-route-page__link" href="/">
          Intentar de nuevo
        </Link>
      </div>
    );
  }

  if (!accounts.length) {
    return (
      <section className="web-home__actions" aria-labelledby="home-actions-title">
        <h2 id="home-actions-title">Primeros pasos</h2>
        <div className="web-home__action-list">
          <Link className="web-home__action" href="/cuentas?crear=1">
            <span aria-hidden="true">
              <Wallet />
            </span>
            Crear su primera cuenta
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="web-home__actions" aria-labelledby="home-actions-title">
      <h2 id="home-actions-title">Acciones rápidas</h2>
      <div className="web-home__action-list">
        <TransactionRegistration
          accounts={accounts}
          compact
          guestMode={guestMode}
          initialType="expense"
          triggerLabel="Registrar una compra"
        />
        <TransactionRegistration
          accounts={accounts}
          compact
          guestMode={guestMode}
          initialType="income"
          triggerLabel="Registrar un ingreso"
        />
        <Link className="web-home__action" href="/cuentas">
          <span aria-hidden="true">
            <Wallet />
          </span>
          Ver mis cuentas
        </Link>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const [guestMode, { accounts, state: dashboardState }] = await Promise.all([
    isGuestMode(),
    loadDashboardPage(),
  ]);

  return (
    <section className="web-route-page" data-route-page data-route-surface="route">
      <header className="web-home__heading">
        <HomeGreeting guestMode={guestMode} />
      </header>
      <HomeActions accounts={accounts} guestMode={guestMode} state={dashboardState} />
      {dashboardState.status === "empty" ? null : (
        <FinanceDashboard compact state={dashboardState} />
      )}
    </section>
  );
}
