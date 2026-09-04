import { AlertsPageClient } from "@/components/product-pages";
import { isGuestMode } from "@/lib/guest-mode";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const guestMode = await isGuestMode();
  return (
    <section className="web-route-page" data-route-page data-route-surface="route">
      <AlertsPageClient guestMode={guestMode} />
    </section>
  );
}
