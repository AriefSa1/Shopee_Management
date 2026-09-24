import { ActionIcon, Burger, Button, Group, Text } from "@mantine/core"
import { IconPlus, IconRefresh } from "@tabler/icons-react"
import { type DateRange, RangePicker } from "./RangePicker.tsx"
import type { DashboardView } from "./Sidebar.tsx"

export function TopBar({
  view,
  range,
  onRangeChange,
  onRefresh,
  onConnect,
  refreshing,
  mobileNavOpen,
  onToggleMobileNav,
}: {
  view: DashboardView
  range: DateRange
  onRangeChange: (range: DateRange) => void
  onRefresh: () => void
  onConnect: () => void
  refreshing: boolean
  mobileNavOpen: boolean
  onToggleMobileNav: () => void
}) {
  const showRange = view === "dashboard" || view === "ads" || view === "inspektur"
  return (
    <Group h="100%" px="lg" gap="sm" wrap="nowrap" style={{ background: "#fff" }}>
      <Burger
        hiddenFrom="md"
        opened={mobileNavOpen}
        onClick={onToggleMobileNav}
        aria-label={mobileNavOpen ? "Tutup menu" : "Buka menu"}
        size="sm"
      />
      <div style={{ flexShrink: 0 }}>
        <Text fw={800} fz={19} lh={1.15}>
          {view === "ads"
            ? "Ads Shopee"
            : view === "produk"
              ? "Produk"
              : view === "inspektur"
                ? "Data Mentah API"
                : "Dashboard"}
        </Text>
        <Text fz={12.5} fw={600} c="dimmed" visibleFrom="sm">
          {view === "ads"
            ? "Performa harian dan cakupan API iklan per toko"
            : view === "produk"
              ? "Katalog produk toko yang terhubung"
              : view === "inspektur"
                ? "Respons mentah API Ads untuk menentukan tampilan"
                : "Ringkasan toko & katalog yang terhubung"}
        </Text>
      </div>

      <Group gap="sm" wrap="nowrap" style={{ marginLeft: "auto" }}>
        {showRange ? <RangePicker value={range} onChange={onRangeChange} /> : null}
        <ActionIcon
          hiddenFrom="sm"
          variant="default"
          size="lg"
          aria-label="Muat ulang"
          onClick={onRefresh}
          loading={refreshing}
        >
          <IconRefresh size={17} />
        </ActionIcon>
        <Button
          visibleFrom="sm"
          variant="default"
          size="md"
          radius="md"
          leftSection={<IconRefresh size={17} />}
          onClick={onRefresh}
          loading={refreshing}
        >
          Muat ulang
        </Button>
        <Button
          visibleFrom="sm"
          size="md"
          radius="md"
          color="cyan"
          leftSection={<IconPlus size={17} stroke={2.4} />}
          onClick={onConnect}
        >
          Hubungkan toko
        </Button>
      </Group>
    </Group>
  )
}
