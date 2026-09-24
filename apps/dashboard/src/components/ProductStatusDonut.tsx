import { DonutChart } from "@mantine/charts"
import { Box, Card, Center, Group, Stack, Text } from "@mantine/core"
import type { Product } from "../api.ts"

const segments = [
  { key: "active", label: "Aktif", color: "#16A34A" },
  { key: "inactive", label: "Nonaktif", color: "#EA580C" },
  { key: "unknown", label: "Tidak diketahui", color: "#94A3B8" },
] as const

export function ProductStatusDonut({
  products,
  loading,
}: {
  products: Product[]
  loading: boolean
}) {
  const counts: Record<string, number> = { active: 0, inactive: 0, unknown: 0 }
  for (const product of products) {
    const key = product.publication ?? "unknown"
    counts[key] = (counts[key] ?? 0) + 1
  }
  const total = products.length
  const data = segments
    .map((segment) => ({ name: segment.label, value: counts[segment.key] ?? 0, color: segment.color }))
    .filter((slice) => slice.value > 0)

  return (
    <Card radius="lg" padding="lg" withBorder>
      <Text fw={800} fz="md">
        Komposisi Produk
      </Text>
      <Text fz={12.5} fw={600} c="dimmed" mt={2}>
        Status publikasi di toko aktif
      </Text>

      <Center my="md" mih={176}>
        {loading ? (
          <Text fz="sm" c="dimmed">
            Memuat…
          </Text>
        ) : total === 0 ? (
          <Text fz="sm" c="dimmed">
            Belum ada produk.
          </Text>
        ) : (
          <DonutChart data={data} size={176} thickness={20} withTooltip chartLabel={`${total} produk`} />
        )}
      </Center>

      <Stack gap={10}>
        {segments.map((segment) => (
          <Group key={segment.key} gap={10} wrap="nowrap">
            <Box w={10} h={10} style={{ borderRadius: 3, background: segment.color }} />
            <Text fz={13.5} fw={600} c="#334155">
              {segment.label}
            </Text>
            <Text className="num" fw={700} fz={13.5} style={{ marginLeft: "auto" }}>
              {counts[segment.key] ?? 0}
            </Text>
          </Group>
        ))}
      </Stack>
    </Card>
  )
}
