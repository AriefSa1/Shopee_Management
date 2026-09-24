import { DonutChart } from "@mantine/charts"
import { Box, Card, Group, Stack, Text } from "@mantine/core"
import { channelSales } from "../data.ts"

export function ChannelBreakdown() {
  const donutData = channelSales.map((slice) => ({
    name: slice.name,
    value: slice.value,
    color: slice.color,
  }))

  return (
    <Card radius="lg" padding="lg" withBorder h="100%">
      <Text fw={800} fz="md">
        Penjualan per Channel
      </Text>
      <Text fz={12.5} fw={600} c="dimmed" mt={2}>
        7 hari terakhir
      </Text>

      <Group justify="center" my="md">
        <DonutChart
          data={donutData}
          size={176}
          thickness={20}
          withTooltip
          chartLabel="Rp 249jt"
          valueFormatter={(value) => `Rp${value}jt`}
        />
      </Group>

      <Stack gap={11}>
        {channelSales.map((slice) => (
          <Group key={slice.name} gap={10} wrap="nowrap">
            <Box w={10} h={10} style={{ borderRadius: 3, background: slice.color }} />
            <Text fz={13.5} fw={600} c="#334155">
              {slice.name}
            </Text>
            <Text className="num" fw={700} fz={13.5} style={{ marginLeft: "auto" }}>
              {slice.share}%
            </Text>
            <Text className="num" fz={13} c="dimmed" w={72} ta="right">
              Rp{slice.value}jt
            </Text>
          </Group>
        ))}
      </Stack>
    </Card>
  )
}
