import { PortabilityWorkspace } from "@/components/portability-workspace";
import { isGuestMode } from "@/lib/guest-mode";

export const dynamic = "force-dynamic";

export default async function PortabilityPage() {
  const guestMode = await isGuestMode();
  return (
    <section className="web-route-page" data-route-page data-route-surface="route">
      <PortabilityWorkspace guestMode={guestMode} />
    </section>
  );
}
