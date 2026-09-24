import { MantineProvider } from "@mantine/core"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@mantine/core/styles.css"
import "@mantine/charts/styles.css"
import "./index.css"
import { App } from "./App.tsx"
import { theme } from "./theme.ts"

const container = document.getElementById("root")
if (container === null) {
  throw new Error("Root container #root was not found")
}

createRoot(container).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <App />
    </MantineProvider>
  </StrictMode>,
)
