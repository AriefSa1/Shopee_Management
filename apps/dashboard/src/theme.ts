import { createTheme } from "@mantine/core"

// Cyan/white brand. Mantine ships a cyan scale; shade 7 reads well on white for
// text-bearing fills (buttons, active states) while brighter shades stay for
// decorative chart accents.
export const theme = createTheme({
  primaryColor: "cyan",
  primaryShade: { light: 7, dark: 5 },
  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
  fontFamilyMonospace: "'Space Grotesk', ui-monospace, monospace",
  headings: {
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    fontWeight: "800",
  },
  defaultRadius: "md",
})
