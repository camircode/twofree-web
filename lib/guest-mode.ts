import "server-only";

import { cookies } from "next/headers";

export const guestModeCookie = "2free-guest";

export async function isGuestMode(): Promise<boolean> {
  return (await cookies()).get(guestModeCookie)?.value === "1";
}
