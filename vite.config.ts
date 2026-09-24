import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// The dashboard SPA (apps/dashboard) is bundled by Vite into apps/web/public,
// which the Hono web process serves as static assets. This is the one build
// step in the repository; the server itself still runs unbundled TypeScript.
// Vendor code is split into a few chunks to keep the bundler's peak memory and
// each chunk's size down, so the memory-constrained deploy build stays stable.
export default defineConfig({
  root: "apps/dashboard",
  base: "/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../web/public",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined
          if (id.includes("recharts") || id.includes("d3-") || id.includes("@mantine/charts")) {
            return "charts"
          }
          if (id.includes("@mantine")) return "mantine"
          if (id.includes("react")) return "react"
          return "vendor"
        },
      },
    },
  },
})
