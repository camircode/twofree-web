import { AccountRegistration } from "@/components/account-registration";
import { AccountsManagement } from "@/components/finance-management";
import { loadAccountsOverview } from "@/lib/finance-pages-adapter";
import { isGuestMode } from "@/lib/guest-mode";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [data, guestMode] = await Promise.all([loadAccountsOverview(), isGuestMode()]);
  return (
    <section className="web-route-page" data-route-page data-route-surface="route">
      <AccountsManagement
        action={<AccountRegistration guestMode={guestMode} />}
        data={data}
        guestMode={guestMode}
      />
    </section>
  );
}
