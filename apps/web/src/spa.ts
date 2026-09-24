import { serveStatic } from "@hono/node-server/serve-static"
import type { Hono } from "hono"

/**
 * Mounts the bundled dashboard SPA (built by Vite into `publicDir`, relative to
 * the process working directory) onto the web app: hashed asset files under
 * `/assets/*`, and the SPA entry document at `/`. Only called when a build is
 * present; the fail-closed HTML dashboard remains the fallback for tests and
 * for processes started without a built frontend.
 */
export function mountDashboardSpa(app: Hono, publicDir: string): void {
  app.use("/assets/*", serveStatic({ root: publicDir }))
  app.use("/favicon.ico", serveStatic({ root: publicDir }))
  app.get("/", serveStatic({ root: publicDir, path: "index.html" }))
}
