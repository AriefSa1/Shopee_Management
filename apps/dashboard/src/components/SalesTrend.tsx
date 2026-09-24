import { AreaChart } from "@mantine/charts"
import { Box, Card, Group, SegmentedControl, Stack, Text } from "@mantine/core"
import { salesTrend } from "../data.ts"

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={7}>
      <Box w={22} h={4} style={{ borderRadius: 2, background: color }} />
      <Text fz={12.5} fw={600} c="#475569">
        {label}
      </Text>
    </Group>
  )
}

export function SalesTrend() {
  return (
    <Card radius="lg" padding="lg" withBorder h="100%">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fw={800} fz="md">
            Tren Penjualan
          </Text>
          <Text fz={12.5} fw={600} c="dimmed" mt={2}>
            Perbandingan minggu ini vs minggu lalu
          </Text>
        </div>
        <SegmentedControl
          size="xs"
          radius="md"
          data={["Omzet", "Pesanan"]}
          defaultValue="Omzet"
        />
      </Group>

      <Group gap="lg" my="md">
        <LegendDot color="var(--mantine-color-cyan-6)" label="Minggu ini" />
        <LegendDot color="#CBD5E1" label="Minggu lalu" />
      </Group>

      <Stack flex={1} justify="center">
        <AreaChart
          h={240}
          data={salesTrend}
          dataKey="day"
          type="default"
          withLegend={false}
          curveType="natural"
          withGradient
          strokeWidth={3}
          withDots={false}
          gridAxis="y"
          valueFormatter={(value) => `Rp${value}jt`}
          series={[
            { name: "Minggu ini", color: "cyan.6" },
            { name: "Minggu lalu", color: "gray.4" },
          ]}
        />
      </Stack>
    </Card>
  )
}
