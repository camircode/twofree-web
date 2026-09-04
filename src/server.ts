import { createServer, type Server } from "node:http";

import { loadRuntimeConfig, type RuntimeConfig } from "@camircode/twofree-application";

export const page = (apiUrl: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>2 Free workspace</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #142b3d; background: #f4f8f6; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      a, button { font: inherit; }
      a { color: #0b6b65; }
      button { border: 0; border-radius: .55rem; background: #0b6b65; color: white; cursor: pointer; padding: .7rem 1rem; font-weight: 700; }
      button:disabled { cursor: wait; opacity: .55; }
      input, select, textarea { border: 1px solid #a8bdb9; border-radius: .45rem; background: white; color: inherit; font: inherit; padding: .65rem .7rem; width: 100%; }
      textarea { min-height: 12rem; font-family: ui-monospace, SFMono-Regular, monospace; }
      .shell { display: grid; grid-template-columns: 15rem minmax(0, 1fr); min-height: 100vh; }
      .sidebar { background: #153f42; color: white; padding: 1.5rem 1rem; }
      .brand { font-size: 1.45rem; font-weight: 800; letter-spacing: -.04em; margin: .3rem .7rem 2rem; }
      .nav { display: grid; gap: .35rem; }
      .nav a { border-radius: .5rem; color: #dcece8; padding: .7rem; text-decoration: none; }
      .nav a:hover, .nav a[aria-current="page"] { background: #2b6968; color: white; }
      .content { max-width: 74rem; padding: clamp(1.2rem, 4vw, 3rem); width: 100%; }
      .eyebrow { color: #55706d; font-size: .78rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      h1 { font-size: clamp(2rem, 4vw, 3.5rem); letter-spacing: -.06em; margin: .2rem 0 .5rem; }
      h2 { letter-spacing: -.03em; margin-top: 0; }
      .lede { color: #55706d; max-width: 45rem; }
      .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); margin: 1.5rem 0; }
      .card, form { background: white; border: 1px solid #d0dfdb; border-radius: .85rem; box-shadow: 0 .5rem 1.5rem #173c4210; padding: 1.2rem; }
      .metric { font-size: 2.2rem; font-weight: 800; margin-top: .4rem; }
      .layout { display: grid; gap: 1rem; grid-template-columns: minmax(16rem, 1fr) minmax(18rem, 1.3fr); }
      form { display: grid; gap: .9rem; align-content: start; }
      label { display: grid; gap: .35rem; font-weight: 700; }
      .form-row { display: grid; gap: .8rem; grid-template-columns: 1fr 1fr; }
      .form-actions { align-items: center; display: flex; gap: .8rem; }
      .feedback { min-height: 1.3rem; }
      [role="alert"] { background: #fff1ef; border: 1px solid #e0a29a; border-radius: .55rem; color: #8b2d24; padding: .8rem; }
      [role="status"] { color: #55706d; }
      .field-error { color: #8b2d24; font-size: .9rem; margin: 0; min-height: 1.2rem; }
      .empty { background: #edf5f1; border-radius: .7rem; color: #55706d; padding: 1rem; }
      .table-wrap { overflow-x: auto; }
      table { border-collapse: collapse; min-width: 100%; text-align: left; }
      th, td { border-bottom: 1px solid #dbe7e3; padding: .8rem .5rem; vertical-align: top; }
      th { color: #55706d; font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; }
      .mono { font-family: ui-monospace, SFMono-Regular, monospace; }
      @media (max-width: 700px) {
        .shell { display: block; }
        .sidebar { padding: 1rem; }
        .brand { margin: .2rem 0 1rem; }
        .nav { grid-template-columns: repeat(4, 1fr); }
        .nav a { font-size: .82rem; padding: .6rem .35rem; text-align: center; }
        .content { padding: 1.2rem; }
        .layout, .form-row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">2 Free</div>
        <nav class="nav" aria-label="Primary navigation">
          <a href="/dashboard">Dashboard</a>
          <a href="/accounts">Accounts</a>
          <a href="/transactions">Transactions</a>
          <a href="/portability">Portability</a>
        </nav>
      </aside>
      <main id="app" class="content" aria-live="polite"><p role="status">Loading workspace.</p></main>
    </div>
    <script>
      const apiUrl = ${JSON.stringify(apiUrl)};
      const app = document.querySelector("#app");
      const routes = ["/dashboard", "/accounts", "/transactions", "/portability"];

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (character) => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[character]);
      }

      function amount(value) {
        const coefficient = String(value.coefficient);
        const negative = coefficient.startsWith("-");
        const digits = negative ? coefficient.slice(1) : coefficient;
        const padded = digits.padStart(value.scale + 1, "0");
        const decimalIndex = padded.length - value.scale;
        const formatted = value.scale === 0
          ? padded
          : padded.slice(0, decimalIndex) + "." + padded.slice(decimalIndex);
        return escapeHtml((negative ? "-" : "") + formatted) + " " + escapeHtml(value.currency);
      }

      function markRoute(route) {
        document.querySelectorAll(".nav a").forEach((link) => {
          link.toggleAttribute("aria-current", link.getAttribute("href") === route);
        });
      }

      function shell(title, content) {
        app.innerHTML = "<p class=\\x22eyebrow\\x22>Cloud workspace</p><h1>" + escapeHtml(title) + "</h1>" + content;
        app.querySelectorAll("form").forEach((form) => form.setAttribute("novalidate", "true"));
      }

      function loading(title) {
        shell(title, "<p role=\\x22status\\x22>Loading " + escapeHtml(title.toLowerCase()) + " data.</p>");
      }

      function errorView(title, retry) {
        shell(title, "<div role=\\x22alert\\x22><strong>" + escapeHtml(retry.message) + "</strong><br><button type=\\x22button\\x22 id=\\x22retry\\x22>Try again</button></div>");
       document.querySelector("#retry").addEventListener("click", () => navigate(window.location.pathname));
      }

      function showFieldError(form, name, message) {
        const field = form.elements.namedItem(name);
        if (!field) return;
        const errorId = field.id + "-error";
        let error = document.querySelector("#" + errorId);
        if (!error) {
          error = document.createElement("p");
          error.className = "field-error";
          error.id = errorId;
          error.setAttribute("role", "alert");
          field.insertAdjacentElement("afterend", error);
        }
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", errorId);
        error.textContent = message;
      }

      document.addEventListener("submit", (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const values = new FormData(form);
        const invalid = [];
        if (form.id === "account-form") {
          if (!String(values.get("label") || "").trim()) invalid.push(["label", "Account label is required."]);
          if (!String(values.get("currency") || "").trim()) invalid.push(["currency", "Currency is required."]);
        }
        if (form.id === "transaction-form") {
          if (!/^-?\\d+$/.test(String(values.get("coefficient") || ""))) invalid.push(["coefficient", "Amount coefficient must be an integer."]);
          if (!/^\\d+$/.test(String(values.get("scale") || ""))) invalid.push(["scale", "Amount scale must be a non-negative integer."]);
        }
        if (!invalid.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        invalid.forEach(([name, message]) => showFieldError(form, name, message));
        form.elements.namedItem(invalid[0][0]).focus();
      }, true);

      async function api(path, options) {
        const request = options || {};
        const headers = Object.assign(request.body ? { "content-type": "application/json" } : {}, request.headers || {});
        const response = await fetch(apiUrl + path, Object.assign({}, request, { headers }));
        let payload = null;
        try { payload = await response.json(); } catch (_) { payload = null; }
        if (!response.ok) {
          if (response.status >= 500) throw new Error("The API is unavailable. Try again.");
          throw new Error(payload && typeof payload.message === "string" ? payload.message : "Request failed. Try again.");
        }
        return payload;
      }

      function accountRows(accounts) {
        if (!accounts.length) return "<p class=\\x22empty\\x22>No accounts yet. Create your first account to begin.</p>";
        return "<div class=\\x22table-wrap\\x22><table><caption class=\\x22eyebrow\\x22>Available accounts</caption><thead><tr><th>Label</th><th>Type</th><th>Currency</th></tr></thead><tbody>" + accounts.map((item) => "<tr><td>" + escapeHtml(item.label) + "</td><td>" + escapeHtml(item.type) + "</td><td>" + escapeHtml(item.currency) + "</td></tr>").join("") + "</tbody></table></div>";
      }

      async function accountsView() {
        loading("Accounts");
        try {
          const data = await api("/accounts");
          shell("Accounts", "<p class=\\x22lede\\x22>Keep a clear inventory of the accounts that make up your financial workspace.</p><div class=\\x22layout\\x22><form id=\\x22account-form\\x22><h2>Create an account</h2><label for=\\x22account-label\\x22>Account label<input id=\\x22account-label\\x22 name=\\x22label\\x22 required autocomplete=\\x22off\\x22></label><label for=\\x22account-type\\x22>Account type<select id=\\x22account-type\\x22 name=\\x22type\\x22><option value=\\x22debit\\x22>Debit</option><option value=\\x22yield\\x22>Yield</option><option value=\\x22revolving-credit\\x22>Revolving credit</option><option value=\\x22charge-card\\x22>Charge card</option></select></label><label for=\\x22account-currency\\x22>Currency<input id=\\x22account-currency\\x22 name=\\x22currency\\x22 required value=\\x22MXN\\x22 maxlength=\\x2232\\x22></label><div class=\\x22form-row\\x22><label for=\\x22statement-coefficient\\x22>Statement coefficient<input id=\\x22statement-coefficient\\x22 name=\\x22statementCoefficient\\x22 inputmode=\\x22numeric\\x22 placeholder=\\x22Credit accounts only\\x22></label><label for=\\x22statement-scale\\x22>Statement scale<input id=\\x22statement-scale\\x22 name=\\x22statementScale\\x22 type=\\x22number\\x22 min=\\x220\\x22 value=\\x222\\x22></label></div><div class=\\x22form-actions\\x22><button type=\\x22submit\\x22>Create account</button><span class=\\x22feedback\\x22 id=\\x22account-feedback\\x22 role=\\x22status\\x22></span></div></form><section class=\\x22card\\x22><h2>Your accounts</h2><div id=\\x22account-list\\x22>" + accountRows(data.accounts) + "</div></section></div>");
          document.querySelector("#account-form").addEventListener("submit", async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const button = form.querySelector("button");
            const feedback = document.querySelector("#account-feedback");
            button.disabled = true;
            feedback.textContent = "Saving account.";
            const values = new FormData(form);
            const type = values.get("type");
            const coefficient = String(values.get("statementCoefficient") || "");
            const command = { type, label: values.get("label"), currency: values.get("currency") };
            if ((type === "revolving-credit" || type === "charge-card") && coefficient) command.statementBalance = { currency: values.get("currency"), coefficient, scale: Number(values.get("statementScale")) };
            try { await api("/accounts", { method: "POST", body: JSON.stringify(command) }); await accountsView(); }
            catch (failure) { button.disabled = false; feedback.textContent = failure.message; }
          });
        } catch (failure) { errorView("Accounts", failure); }
      }

      function transactionRows(transactions) {
        if (!transactions.length) return "<p class=\\x22empty\\x22>No transactions yet. Record the first movement from the form.</p>";
        return "<div class=\\x22table-wrap\\x22><table><caption class=\\x22eyebrow\\x22>Recent transactions</caption><thead><tr><th>Account</th><th>Amount</th><th>Reference</th></tr></thead><tbody>" + transactions.map((item) => "<tr><td>" + escapeHtml(item.accountId) + "</td><td>" + amount(item.amount) + "</td><td class=\\x22mono\\x22>" + escapeHtml(item.id) + "</td></tr>").join("") + "</tbody></table></div>";
      }

      async function transactionsView() {
        loading("Transactions");
        try {
          const data = await Promise.all([api("/accounts"), api("/transactions")]);
          const accounts = data[0].accounts;
          shell("Transactions", "<p class=\\x22lede\\x22>Record exact movements without moving business rules into the browser.</p><div class=\\x22layout\\x22><form id=\\x22transaction-form\\x22><h2>Record a transaction</h2><label for=\\x22transaction-account\\x22>Account<select id=\\x22transaction-account\\x22 name=\\x22accountId\\x22 required>" + accounts.map((item) => "<option value=\\x22" + escapeHtml(item.id) + "\\x22>" + escapeHtml(item.label) + " (" + escapeHtml(item.currency) + ")</option>").join("") + "</select></label><div class=\\x22form-row\\x22><label for=\\x22amount-coefficient\\x22>Amount coefficient<input id=\\x22amount-coefficient\\x22 name=\\x22coefficient\\x22 required inputmode=\\x22numeric\\x22></label><label for=\\x22amount-scale\\x22>Amount scale<input id=\\x22amount-scale\\x22 name=\\x22scale\\x22 type=\\x22number\\x22 min=\\x220\\x22 value=\\x222\\x22 required></label></div><label for=\\x22transaction-currency\\x22>Currency<input id=\\x22transaction-currency\\x22 name=\\x22currency\\x22 required value=\\x22MXN\\x22></label><label for=\\x22idempotency-key\\x22>Idempotency-Key<input id=\\x22idempotency-key\\x22 name=\\x22idempotencyKey\\x22 required autocomplete=\\x22off\\x22 value=\\x22web-" + Date.now() + "\\x22></label><div class=\\x22form-actions\\x22><button type=\\x22submit\\x22>Create transaction</button><span class=\\x22feedback\\x22 id=\\x22transaction-feedback\\x22 role=\\x22status\\x22></span></div></form><section class=\\x22card\\x22><h2>Recorded movements</h2><div id=\\x22transaction-list\\x22>" + transactionRows(data[1].transactions) + "</div></section></div>");
          document.querySelector("#transaction-form").addEventListener("submit", async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const button = form.querySelector("button");
            const feedback = document.querySelector("#transaction-feedback");
            button.disabled = true;
            feedback.textContent = "Saving transaction.";
            const values = new FormData(form);
            const command = { accountId: values.get("accountId"), amount: { currency: values.get("currency"), coefficient: values.get("coefficient"), scale: Number(values.get("scale")) } };
            try { await api("/transactions", { method: "POST", headers: { "Idempotency-Key": values.get("idempotencyKey") }, body: JSON.stringify(command) }); await transactionsView(); }
            catch (failure) { button.disabled = false; feedback.textContent = failure.message; }
          });
        } catch (failure) { errorView("Transactions", failure); }
      }

      async function dashboardView() {
        loading("Dashboard");
        try {
          const data = await api("/dashboard");
          const accountLabel = data.accountCount === 1 ? "1 account" : data.accountCount + " accounts";
          const transactionLabel = data.transactionCount === 1 ? "1 transaction" : data.transactionCount + " transactions";
          const totals = data.totals.length ? data.totals.map((item) => "<li>" + amount(item) + "</li>").join("") : "<li class=\\x22empty\\x22>No totals yet.</li>";
          shell("Dashboard", "<p class=\\x22lede\\x22>A calm view of the exact data held by the cloud product boundary.</p><div class=\\x22grid\\x22><section class=\\x22card\\x22><div class=\\x22eyebrow\\x22>Accounts</div><div class=\\x22metric\\x22>" + escapeHtml(accountLabel) + "</div></section><section class=\\x22card\\x22><div class=\\x22eyebrow\\x22>Transactions</div><div class=\\x22metric\\x22>" + escapeHtml(transactionLabel) + "</div></section><section class=\\x22card\\x22><div class=\\x22eyebrow\\x22>Exact totals</div><ul>" + totals + "</ul></section></div><section class=\\x22card\\x22><h2>Next actions</h2><p>Review <a href=\\x22/accounts\\x22>accounts</a>, record a <a href=\\x22/transactions\\x22>transaction</a>, or protect a copy from the <a href=\\x22/portability\\x22>portability</a> screen.</p></section>");
        } catch (failure) { errorView("Dashboard", failure); }
      }

      async function portabilityView() {
        shell("Portability", "<p class=\\x22lede\\x22>Export a deterministic copy or import a validated v1 envelope through the API boundary.</p><div class=\\x22layout\\x22><section class=\\x22card\\x22><h2>Export</h2><p id=\\x22export-feedback\\x22 role=\\x22status\\x22>Ready to export the current workspace.</p><button type=\\x22button\\x22 id=\\x22export\\x22>Export data</button><label for=\\x22exported-data\\x22>Exported data<textarea id=\\x22exported-data\\x22 readonly></textarea></label></section><form id=\\x22import-form\\x22><h2>Import</h2><label for=\\x22imported-data\\x22>Versioned JSON<textarea id=\\x22imported-data\\x22 required placeholder=\\x22Paste a v1 envelope\\x22></textarea></label><div class=\\x22form-actions\\x22><button type=\\x22submit\\x22>Import data</button><span class=\\x22feedback\\x22 id=\\x22import-feedback\\x22 role=\\x22status\\x22></span></div></form></div>");
        document.querySelector("#export").addEventListener("click", async () => {
          const button = document.querySelector("#export");
          const feedback = document.querySelector("#export-feedback");
          button.disabled = true;
          feedback.textContent = "Exporting data.";
          try { const data = await api("/export"); document.querySelector("#exported-data").value = JSON.stringify(data, null, 2); feedback.textContent = "Export ready."; }
          catch (failure) { feedback.textContent = failure.message; }
          finally { button.disabled = false; }
        });
        document.querySelector("#import-form").addEventListener("submit", async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const button = form.querySelector("button");
          const feedback = document.querySelector("#import-feedback");
          button.disabled = true;
          feedback.textContent = "Importing data.";
          try { await api("/import", { method: "POST", body: document.querySelector("#imported-data").value }); feedback.textContent = "Import complete."; }
          catch (failure) { feedback.textContent = failure.message; }
          finally { button.disabled = false; }
        });
      }

      function navigate(path) {
        const route = routes.includes(path) ? path : "/dashboard";
        markRoute(route);
        if (route === "/accounts") return accountsView();
        if (route === "/transactions") return transactionsView();
        if (route === "/portability") return portabilityView();
        return dashboardView();
      }

      navigate(routes.includes(window.location.pathname) ? window.location.pathname : "/dashboard");
    </script>
  </body>
</html>`;

export function createWebServer(config: RuntimeConfig, apiUrl: string): Server {
  return createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ready", target: "web" }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page(apiUrl));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const config = loadRuntimeConfig();
    const publicApiUrl = process.env.PUBLIC_API_URL?.trim();
    if (!publicApiUrl) throw new Error("PUBLIC_API_URL must be configured");
    createWebServer(config, publicApiUrl).listen(config.webPort, config.webHost, () =>
      console.log(`2 Free web listening on http://${config.webHost}:${config.webPort}`),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid configuration");
    process.exitCode = 1;
  }
}
