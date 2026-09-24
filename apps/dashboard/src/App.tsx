import { AppShell, Grid, Stack } from "@mantine/core"
import { ChannelBreakdown } from "./components/ChannelBreakdown.tsx"
import { RecentOrders } from "./components/RecentOrders.tsx"
import { SalesTrend } from "./components/SalesTrend.tsx"
import { Sidebar } from "./components/Sidebar.tsx"
import { SidePanels } from "./components/SidePanels.tsx"
import { StatCards } from "./components/StatCards.tsx"
import { TopBar } from "./components/TopBar.tsx"

export function App() {
  return (
    <AppShell
      layout="alt"
      navbar={{ width: 250, breakpoint: "md" }}
      header={{ height: 72 }}
      padding="lg"
      styles={{ main: { background: "var(--app-bg)" } }}
    >
      <AppShell.Navbar withBorder>
        <Sidebar />
      </AppShell.Navbar>

      <AppShell.Header withBorder>
        <TopBar />
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="lg">
          <StatCards />

          <Grid gap="lg">
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <SalesTrend />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <ChannelBreakdown />
            </Grid.Col>
          </Grid>

          <Grid gap="lg">
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <RecentOrders />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <SidePanels />
            </Grid.Col>
          </Grid>
        </Stack>
      </AppShell.Main>
    </AppShell>
  )
}
