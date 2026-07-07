const app = document.querySelector("#app");
if (app) app.setAttribute("data-boot", "loading");

import("./portal-app.js?v=20260508-6").then(() => {
  window.__acfBooted = true;
  if (app) app.setAttribute("data-boot", "ready");
}).catch((error) => {
  const app = document.querySelector("#app");
  if (!app) return;
  const message = error && error.message ? error.message : String(error || "Unknown startup error");
  app.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f6f7fb;color:#172033;font-family:Inter,ui-sans-serif,system-ui">
      <section style="max-width:860px;width:100%;background:#fff;border:1px solid #e7e9ef;border-radius:10px;padding:18px 20px;box-shadow:0 10px 24px rgba(20,30,55,.08)">
        <h2 style="margin:0 0 10px;color:#8b1538">Frontend Startup Error</h2>
        <p style="margin:0 0 10px">The portal script crashed before rendering. Please share this message.</p>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px">${message}</pre>
      </section>
    </main>
  `;
});
