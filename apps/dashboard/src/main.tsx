import { MantineProvider } from "@mantine/core"
import { DatesProvider } from "@mantine/dates"
import dayjs from "dayjs"
import "dayjs/locale/id"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@mantine/core/styles.css"
import "@mantine/charts/styles.css"
import "@mantine/dates/styles.css"
import "./index.css"
import { App } from "./App.tsx"
import { theme } from "./theme.ts"

dayjs.locale("id")

const container = document.getElementById("root")
if (container === null) {
  throw new Error("Root container #root was not found")
}

createRoot(container).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <DatesProvider settings={{ locale: "id" }}>
        <App />
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
)
