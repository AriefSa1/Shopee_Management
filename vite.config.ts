import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// The dashboard SPA (apps/dashboard) is bundled by Vite into apps/web/public,
// which the Hono web process serves as static assets. This is the one build
// step in the repository; the server itself still runs unbundled TypeScript.
export default defineConfig({
  root: "apps/dashboard",
  base: "/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../web/public",
    emptyOutDir: true,
  },
})
