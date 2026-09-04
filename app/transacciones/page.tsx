import Link from "next/link";

import { TransactionsManagement } from "@/components/finance-management";
import { TransactionRegistration } from "@/components/transaction-registration";
import { loadTransactionsOverview } from "@/lib/finance-pages-adapter";
import { isGuestMode } from "@/lib/guest-mode";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const [guestMode, { accounts, data }] = await Promise.all([
    isGuestMode(),
    loadTransactionsOverview(),
  ]);
  return (
    <section className="web-route-page" data-route-page data-route-surface="route">
      <TransactionsManagement
        accounts={accounts}
        data={data}
        guestMode={guestMode}
        registrationAction={
          accounts.length ? (
            <TransactionRegistration accounts={accounts} guestMode={guestMode} />
          ) : (
            <Link
              className="ui-portfolio__button ui-portfolio__button--dark"
              href="/cuentas?crear=1"
            >
              Crear cuenta para registrar movimientos
            </Link>
          )
        }
      />
    </section>
  );
}
