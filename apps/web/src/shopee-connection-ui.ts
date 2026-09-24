import type { OrganizationId } from "../../../packages/identity/src/model.ts"
import type { PartnerApplicationIdSchema } from "../../../packages/oauth/src/model.ts"

export type ShopeeConnectionUiConfig = {
  readonly organizationId: OrganizationId
  readonly partnerApplicationId: ReturnType<typeof PartnerApplicationIdSchema.parse>
  readonly market: "ID"
}

export function createShopeeConnectionUiHandler(config: ShopeeConnectionUiConfig): Response {
  const oauthStartPath = `/api/auth/shopee/start?${new URLSearchParams({
    organizationId: config.organizationId,
    partnerApplicationId: config.partnerApplicationId,
    market: config.market,
  }).toString()}`
  const encodedOAuthStartPath = JSON.stringify(oauthStartPath)

  const html = `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Koneksi aman toko Shopee untuk dashboard internal.">
    <title>Hubungkan Shopee · Shopee Management</title>
    <style>
      :root {
        color-scheme: dark;
        --canvas: #101827;
        --canvas-elevated: #172235;
        --surface: #1d2a3d;
        --surface-raised: #24344a;
        --border: #34465e;
        --text: #f3f7fb;
        --muted: #a8b8ca;
        --signal: #63d7c5;
        --signal-strong: #37b8a6;
        --danger: #ff9b92;
        --danger-soft: #47272b;
        --focus: #92c8ff;
        --radius-control: 0.5rem;
        --radius-card: 0.875rem;
        --space-1: 0.25rem;
        --space-2: 0.5rem;
        --space-3: 0.75rem;
        --space-4: 1rem;
        --space-5: 1.5rem;
        --space-6: 2rem;
        --space-7: 3rem;
        --motion: 160ms ease-out;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-block-size: 100dvb; background: radial-gradient(circle at top right, var(--canvas-elevated), var(--canvas) 38rem); color: var(--text); font-family: system-ui, "Segoe UI", sans-serif; line-height: 1.5; }
      a { color: inherit; }
      a:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: var(--space-1); }
      .shell { inline-size: min(100% - (var(--space-6) * 2), 62rem); margin-inline: auto; padding-block: var(--space-6) var(--space-7); }
      .back { color: var(--muted); font-size: 0.875rem; text-underline-offset: var(--space-1); }
      main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 26rem); gap: var(--space-7); align-items: center; min-block-size: calc(100dvb - 8rem); }
      .intro { display: grid; gap: var(--space-4); }
      .eyebrow { margin: 0; color: var(--signal); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.8125rem; letter-spacing: 0.08em; text-transform: uppercase; }
      h1 { margin: 0; max-inline-size: 13ch; font-size: clamp(2.25rem, 7vw, 4.25rem); line-height: 1.02; letter-spacing: -0.05em; }
      .intro__copy { margin: 0; max-inline-size: 38rem; color: var(--muted); font-size: 1.0625rem; }
      .steps { display: grid; gap: var(--space-3); margin: var(--space-2) 0 0; padding: 0; list-style: none; counter-reset: step; }
      .steps li { display: grid; grid-template-columns: 2rem 1fr; gap: var(--space-3); align-items: start; color: var(--muted); }
      .steps li::before { display: grid; place-items: center; inline-size: 2rem; block-size: 2rem; border: 1px solid var(--border); border-radius: 50%; color: var(--signal); content: counter(step); counter-increment: step; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.8125rem; }
      .panel { display: grid; gap: var(--space-5); padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: 0 1.25rem 3rem rgba(0, 0, 0, 0.24); }
      .panel__heading { display: grid; gap: var(--space-2); }
      h2, p { margin: 0; }
      h2 { font-size: 1.25rem; }
      .panel__copy, .field__hint { color: var(--muted); font-size: 0.875rem; }
      form { display: grid; gap: var(--space-4); }
      .field { display: grid; gap: var(--space-2); }
      label { font-weight: 700; }
      input { inline-size: 100%; min-block-size: 3rem; padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--canvas-elevated); color: var(--text); font: inherit; transition: border-color var(--motion), background var(--motion); }
      input:hover { border-color: var(--muted); }
      input[aria-invalid="true"] { border-color: var(--danger); }
      button { display: inline-flex; align-items: center; justify-content: center; min-block-size: 3rem; padding: var(--space-3) var(--space-5); border: 0; border-radius: var(--radius-control); background: var(--signal); color: #092523; cursor: pointer; font: inherit; font-weight: 800; transition: background var(--motion), transform var(--motion); }
      button:hover:not(:disabled) { background: var(--signal-strong); }
      button:active:not(:disabled) { transform: scale(0.98); }
      button:disabled { cursor: wait; opacity: 0.7; }
      button.secondary { min-block-size: 2.5rem; background: transparent; color: var(--muted); border: 1px solid var(--border); font-weight: 600; }
      button.secondary:hover:not(:disabled) { background: var(--surface-raised); color: var(--text); }
      .message { min-block-size: 1.5rem; padding: 0; color: var(--muted); font-size: 0.875rem; }
      .message[data-tone="error"] { padding: var(--space-3); border-radius: var(--radius-control); background: var(--danger-soft); color: var(--danger); }
      .security { padding-block-start: var(--space-4); border-block-start: 1px solid var(--border); color: var(--muted); font-size: 0.8125rem; }
      [hidden] { display: none !important; }
      @media (max-width: 48rem) { .shell { inline-size: min(100% - (var(--space-4) * 2), 62rem); } main { grid-template-columns: 1fr; gap: var(--space-6); padding-block: var(--space-6); } h1 { max-inline-size: 15ch; } }
      @media (prefers-reduced-motion: reduce) { input, button { transition: none; } button:active:not(:disabled) { transform: none; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <a class="back" href="/">← Kembali ke dashboard</a>
      <main>
        <section class="intro" aria-labelledby="page-title">
          <p class="eyebrow">Secure connection</p>
          <h1 id="page-title">Hubungkan toko ke Shopee</h1>
          <p class="intro__copy">Masuk sebagai operator internal, lalu Anda akan diarahkan ke halaman resmi Shopee untuk menyetujui koneksi toko.</p>
          <ol class="steps">
            <li>Sekali masukkan token login internal; browser mengingatnya untuk kunjungan berikutnya.</li>
            <li>Selama sesi masih aktif, Anda langsung ke tombol hubungkan tanpa token lagi.</li>
            <li>Selesaikan persetujuan toko di domain resmi Shopee.</li>
          </ol>
        </section>
        <section class="panel" aria-labelledby="connection-title">
          <div class="panel__heading">
            <h2 id="connection-title">Mulai koneksi aman</h2>
            <p class="panel__copy" id="panel-copy">Token hanya dikirim ke server ini melalui HTTPS dan tidak dimasukkan ke URL.</p>
          </div>
          <form id="connection-form" novalidate>
            <div class="field" id="token-field">
              <label for="login-token">Token login internal</label>
              <input id="login-token" name="loginToken" type="password" inputmode="text" autocomplete="off" minlength="43" maxlength="43" pattern="[A-Za-z0-9_-]{43}" required aria-describedby="token-hint connection-message">
              <span id="token-hint" class="field__hint">Gunakan nilai <code>INTERNAL_LOGIN_TOKEN</code>, bukan Partner Key Shopee.</span>
            </div>
            <button id="submit-button" type="submit">Hubungkan ke Shopee</button>
            <button id="logout-button" type="button" class="secondary" hidden>Keluar sesi internal</button>
            <p id="connection-message" class="message" role="status" aria-live="polite"></p>
          </form>
          <p class="security">Partner Key dan access token Shopee tetap berada di server. Halaman ini tidak pernah menampilkan kembali token yang Anda masukkan.</p>
        </section>
      </main>
    </div>
    <script>
      const form = document.getElementById("connection-form")
      const input = document.getElementById("login-token")
      const button = document.getElementById("submit-button")
      const logoutButton = document.getElementById("logout-button")
      const tokenField = document.getElementById("token-field")
      const panelCopy = document.getElementById("panel-copy")
      const message = document.getElementById("connection-message")
      const oauthStartPath = ${encodedOAuthStartPath}
      const TOKEN_STORAGE_KEY = "shopee_internal_login_token"
      let sessionActive = false

      const setState = (text, tone = "neutral") => {
        message.textContent = text
        message.dataset.tone = tone
      }

      const readErrorCode = async (response) => {
        try {
          const body = await response.json()
          return typeof body?.error?.code === "string" ? body.error.code : "request_failed"
        } catch {
          return "request_failed"
        }
      }

      const readStoredToken = () => {
        try { return localStorage.getItem(TOKEN_STORAGE_KEY) } catch { return null }
      }
      const storeToken = (value) => {
        try { localStorage.setItem(TOKEN_STORAGE_KEY, value) } catch {}
      }
      const clearStoredToken = () => {
        try { localStorage.removeItem(TOKEN_STORAGE_KEY) } catch {}
      }

      const restoreIdleButton = () => {
        button.disabled = false
        button.textContent = "Hubungkan ke Shopee"
      }

      const enterSessionActiveMode = () => {
        sessionActive = true
        input.value = ""
        input.required = false
        input.disabled = true
        if (tokenField) tokenField.hidden = true
        if (logoutButton) logoutButton.hidden = false
        if (panelCopy) panelCopy.textContent = "Sesi internal masih aktif. Anda bisa langsung menghubungkan toko."
        setState("Sesi internal aktif. Langsung hubungkan toko Shopee.")
      }

      const startOauth = async () => {
        setState("Membuat permintaan OAuth Shopee…")
        const oauthResponse = await fetch(oauthStartPath, { credentials: "same-origin" })
        if (!oauthResponse.ok) throw new Error(await readErrorCode(oauthResponse))
        const payload = await oauthResponse.json()
        const authorizationUrl = payload?.data?.authorizationUrl
        if (typeof authorizationUrl !== "string" || !authorizationUrl.startsWith("https://")) {
          throw new Error("invalid_authorization_url")
        }
        setState("Mengalihkan ke Shopee…")
        window.location.assign(authorizationUrl)
      }

      const storedToken = readStoredToken()
      if (storedToken) input.value = storedToken

      fetch("/api/session/status", { credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : null))
        .then((status) => {
          if (status && status.authenticated === true) enterSessionActiveMode()
        })
        .catch(() => {})

      if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
          logoutButton.disabled = true
          try {
            await fetch("/api/session/logout", { method: "POST", credentials: "same-origin" })
          } catch {}
          clearStoredToken()
          window.location.reload()
        })
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault()
        input.setAttribute("aria-invalid", "false")
        button.disabled = true
        button.textContent = "Menyiapkan koneksi…"

        try {
          if (!sessionActive) {
            if (!form.reportValidity()) {
              restoreIdleButton()
              return
            }
            setState("Memverifikasi sesi internal…")
            const loginResponse = await fetch("/api/session/login", {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ loginToken: input.value }),
            })
            if (!loginResponse.ok) {
              input.setAttribute("aria-invalid", "true")
              throw new Error(await readErrorCode(loginResponse))
            }
            storeToken(input.value)
          }
          await startOauth()
        } catch (error) {
          const code = error instanceof Error ? error.message : "request_failed"
          if (code === "authentication_failed") {
            clearStoredToken()
            input.value = ""
          }
          restoreIdleButton()
          button.textContent = "Coba lagi"
          const text = code === "authentication_failed"
            ? "Token login internal tidak cocok. Periksa nilainya lalu coba lagi."
            : "Koneksi belum dapat dimulai. Periksa konfigurasi server atau coba lagi."
          setState(text, "error")
          if (!input.disabled) input.focus()
        }
      })
    </script>
  </body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "content-type": "text/html; charset=UTF-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  })
}
