# Shopee Management Dashboard Design System

## 0. Research Log

- Embedded references: operational dashboard shortlist was Sentry, PostHog, and ClickHouse; Sentry was selected as the reference for data-dense status surfaces, then adapted without copying its branding.
- Lazyweb screens: not used for this first status shell because the product has no existing visual reference and the scope is a safety/status surface, not a brand imitation.
- Imagen drafts: not used; a generated visual would add no evidence or operational value to a read-only server shell.

## 1. Product Surface

The dashboard helps an operator answer whether the web process and database are ready. When the live OAuth runtime is enabled, it also exposes a secure operator entry point for connecting a Shopee shop without placing internal credentials in a URL.

Atmosphere: calm technical control room. The surface uses an ink-blue canvas, a warm cyan signal color for healthy infrastructure, and restrained amber for capabilities that still require live-provider evidence.

## 2. Tokens

```text
color.canvas = #101827
color.canvasElevated = #172235
color.surface = #1d2a3d
color.surfaceRaised = #24344a
color.border = #34465e
color.text = #f3f7fb
color.textMuted = #a8b8ca
color.signal = #63d7c5
color.signalSoft = #163a3b
color.pending = #f4bd68
color.pendingSoft = #44351f
color.focus = #92c8ff

type.display = system-ui, Segoe UI, sans-serif
type.body = system-ui, Segoe UI, sans-serif
type.mono = ui-monospace, SFMono-Regular, Consolas, monospace
type.displaySize = 2.5rem
type.headingSize = 1.25rem
type.bodySize = 1rem
type.captionSize = 0.8125rem

space.1 = 0.25rem
space.2 = 0.5rem
space.3 = 0.75rem
space.4 = 1rem
space.5 = 1.5rem
space.6 = 2rem
space.7 = 3rem

radius.control = 0.5rem
radius.card = 0.875rem
depth.card = 0 1rem 2.5rem rgba(0, 0, 0, 0.18)
motion.standard = 160ms ease-out
```

## 3. Typography

System UI is used so the shell has no external font dependency. Display headings are bold and compact; body copy stays at a readable measure; route names and status values use the mono token to distinguish machine state from explanatory text.

## 4. Layout

The page uses a document scroll model. `main` owns normal document flow; no nested scroll container is introduced for the first shell. The content limiter is capped at 72rem and uses intrinsic grids with `min(18rem, 100%)` so 375px screens do not overflow.

## 5. Primitives and States

- `shell`: page frame with skip link, header, main, and footer.
- `status-card`: healthy, unavailable, and unknown states; the first shell renders the unknown/pending state for features that are not wired yet.
- `capability-card`: read-only, provider-pending, or unavailable copy; never presents a disabled mutation as if it were available.
- `route-link`: keyboard-focusable link to a real endpoint; focus uses `color.focus` and a visible outline.
- `secure-token-form`: labeled password input, stateful submit button, and live status message for the internal OAuth entry point.

## 6. Interaction and Motion

The dashboard shell remains server-rendered. The OAuth connection page uses one stateful interaction: idle, authenticating, creating OAuth request, and redirecting or error. Motion is limited to short control-state transitions and is disabled by `prefers-reduced-motion`.

## 7. Accessibility Constraints

- `html[lang]`, a unique `title`, viewport metadata, and landmark elements are required.
- Status descriptions use text, not color alone.
- Every route link is keyboard reachable with a visible focus outline.
- The page remains readable at narrow widths and supports forced-colors mode through semantic contrast and borders.
- No secret, token, raw upstream payload, or personally identifying value is rendered.
- The token field is labeled, never repopulated, and cleared after every submit attempt. Progress and errors use an `aria-live` status region.

## 8. Accepted Debt

- The shell does not yet include authenticated shop selection, live catalog rows, or analytics charts.
- The OAuth callback currently returns a safe JSON handoff result; a dedicated browser completion page remains future product work.

## 9. React operator dashboard

The React dashboard in `apps/dashboard` is a separate operator surface from the server-rendered status shell above. It uses Mantine's light theme with cyan as the primary action and status color, Plus Jakarta Sans for body and headings, Space Grotesk for tabular metrics, white bordered cards, and the existing `--app-bg` canvas. Keep new dashboard controls within Mantine's spacing, radius, and color tokens.

The Ads workspace reuses the existing sidebar navigation, store selector, status alert, bordered cards, and search controls. Its endpoint row uses `gray.0` fill, `gray.2` border, and `md` radius. States are: no selected store, selected store with ready or unready token, loading or unavailable daily Ads data, documented read or action endpoint, the Ads Fácil endpoint unavailable for Seller In House System, and the two Shopee endpoints marked “coming offline soon”. The `—` metric value means unavailable, never zero. The CPC daily read uses a server-side shop-scoped adapter; links for all 25 endpoints remain available, and mutation controls do not appear until a server-side authorization and confirmation flow exists.

Ads sizing tokens on the React surface: `--ads-select-width` (13.75rem), `--ads-chart-height` (13.75rem), `--ads-table-min-width` (38.75rem), and `--ads-search-min-width` (15rem). These give the store control, trend, scroll-contained table, and search field stable proportions across the Ads states.

Below the `md` breakpoint, the shared navigation begins collapsed. A labeled burger button in the header opens it, and choosing a destination closes it so the page content is reachable. The four Ads metric cards become two columns at narrow widths; the daily table has its own horizontal scroll container without widening the page.
