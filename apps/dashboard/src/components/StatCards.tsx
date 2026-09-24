import { Card, Group, SimpleGrid, Text, ThemeIcon } from "@mantine/core"
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconBox,
  IconChartBar,
  IconReceipt2,
  IconShoppingCart,
} from "@tabler/icons-react"
import { type Kpi, kpis } from "../data.ts"

const iconMap = {
  sales: IconReceipt2,
  orders: IconShoppingCart,
  units: IconBox,
  avg: IconChartBar,
} as const

const iconColor: Record<Kpi["icon"], string> = {
  sales: "#0E7490",
  orders: "#2563EB",
  units: "#7C3AED",
  avg: "#EA580C",
}

function Sparkline({ color, up }: { color: string; up: boolean }) {
  const path = up
    ? "M2 24 L14 20 L26 22 L38 14 L50 17 L62 8 L74 11 L86 5"
    : "M2 8 L14 12 L26 10 L38 15 L50 13 L62 19 L74 18 L86 23"
  return (
    <svg width="88" height="30" viewBox="0 0 88 30" fill="none" aria-hidden="true">
      <path d={path} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function StatCards() {
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="lg">
      {kpis.map((kpi) => {
        const Icon = iconMap[kpi.icon]
        const up = kpi.delta >= 0
        return (
          <Card key={kpi.key} radius="lg" padding="lg" withBorder>
            <Group justify="space-between">
              <Text fz="sm" fw={600} c="dimmed">
                {kpi.label}
              </Text>
              <ThemeIcon size={34} radius="md" variant="light" style={{ background: kpi.tint }}>
                <Icon size={17} color={iconColor[kpi.icon]} />
              </ThemeIcon>
            </Group>

            <Text className="num" fz={27} fw={700} mt={10}>
              {kpi.value}
              {kpi.unit ? (
                <Text span fz={16} fw={600} c="dimmed">
                  {kpi.unit}
                </Text>
              ) : null}
            </Text>

            <Group justify="space-between" mt={8}>
              <Group gap={4} c={up ? "#15803D" : "#B91C1C"}>
                {up ? <IconArrowUpRight size={14} stroke={2.4} /> : <IconArrowDownRight size={14} stroke={2.4} />}
                <Text fz={12.5} fw={700}>
                  {Math.abs(kpi.delta).toLocaleString("id-ID")}%
                </Text>
              </Group>
              <Sparkline color={iconColor[kpi.icon]} up={up} />
            </Group>
          </Card>
        )
      })}
    </SimpleGrid>
  )
}
