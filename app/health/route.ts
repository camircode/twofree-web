export const dynamic = "force-static";

export function GET(): Response {
  return new Response(JSON.stringify({ status: "ready" }), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  });
}
