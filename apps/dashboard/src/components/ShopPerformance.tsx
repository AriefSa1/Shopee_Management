import { AreaChart } from "@mantine/charts"
import {
  Alert,
  Badge,
  Box,
  Card,
  Center,
  Group,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core"
import { IconAlertCircle, IconArrowDownRight, IconArrowUpRight, IconPhoto } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import {
  api,
  ApiError,
  type HotListing,
  type HotListingPeriod,
  pickOrderType,
} from "../api.ts"

const nf = new Intl.NumberFormat("id-ID")

function rupiahCompact(value: number | undefined): string {
  if (value === undefined) return "—"
  if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1).replace(".", ",")}jt`
  if (value >= 1_000) return `Rp ${(value / 1_000).toFixed(0)}rb`
  return `Rp ${nf.format(Math.round(value))}`
}

function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${(value * 100).toFixed(1).replace(".", ",")}%`
}

const periodData: { label: string; value: HotListingPeriod }[] = [
  { label: "Hari ini", value: "real_time" },
  { label: "Kemarin", value: "yesterday" },
  { label: "7 hari", value: "past7days" },
  { label: "30 hari", value: "past30days" },
]

function Delta({ value }: { value: number | undefined }) {
  if (value === undefined) return null
  const up = value >= 0
  return (
    <Group gap={3} c={up ? "#15803D" : "#B91C1C"}>
      {up ? <IconArrowUpRight size={14} stroke={2.4} /> : <IconArrowDownRight size={14} stroke={2.4} />}
      <Text fz={12.5} fw={700}>
        {Math.abs(value * 100).toFixed(1).replace(".", ",")}%
      </Text>
    </Group>
  )
}

function MetricCard({
  label,
  value,
  delta,
  tint,
}: {
  label: string
  value: string
  delta?: number
  tint: string
}) {
  return (
    <Box p="md" style={{ borderRadius: 14, background: tint }}>
      <Text fz="sm" fw={600} c="#475569">
        {label}
      </Text>
      <Text className="num" fz={24} fw={800} mt={6}>
        {value}
      </Text>
      <Box mt={4}>
        <Delta value={delta} />
      </Box>
    </Box>
  )
}

function formatBucket(t: number | undefined, period: HotListingPeriod): string {
  if (t === undefined) return ""
  const date = new Date(t * 1000)
  if (period === "real_time" || period === "yesterday") {
    return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
  }
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short" })
}

export function ShopPerformance({ shopId }: { shopId: string | null }) {
  const [period, setPeriod] = useState<HotListingPeriod>("past7days")
  const [data, setData] = useState<HotListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (shopId === null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .hotListing(shopId, period)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((cause) => {
        if (!cancelled) {
          setData(null)
          setError(cause instanceof ApiError ? cause.code : "error")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shopId, period])

  const chosen = data ? pickOrderType(data.orderTypes) : undefined
  const metrics = chosen?.metrics
  const series = (chosen?.timeSeries ?? [])
    .filter((point) => point.t !== undefined)
    .map((point) => ({ label: formatBucket(point.t, period), Penjualan: point.sales ?? 0 }))
  const topProducts = (chosen?.performance ?? []).slice(0, 6)

  return (
    <Card radius="lg" padding="lg" withBorder>
      <Group justify="space-between" align="flex-start" wrap="wrap" mb="md">
        <div>
          <Text fw={800} fz="lg">
            Performa Toko
          </Text>
          <Text fz={12.5} fw={600} c="dimmed" mt={2}>
            Data penjualan langsung dari Shopee Business Insights
          </Text>
        </div>
        <SegmentedControl
          size="xs"
          radius="md"
          data={periodData}
          value={period}
          onChange={(value) => setPeriod(value as HotListingPeriod)}
        />
      </Group>

      {shopId === null ? (
        <Text c="dimmed" ta="center" py="xl">
          Hubungkan toko untuk melihat performa.
        </Text>
      ) : loading ? (
        <Center py="xl">
          <Loader color="cyan" />
        </Center>
      ) : error ? (
        <Alert color="orange" icon={<IconAlertCircle size={16} />} radius="md">
          Data performa belum tersedia (<span className="num">{error}</span>). Pastikan aplikasi Shopee
          punya izin Business Insights untuk toko ini.
        </Alert>
      ) : metrics === undefined ? (
        <Text c="dimmed" ta="center" py="xl">
          Belum ada data performa untuk periode ini.
        </Text>
      ) : (
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
            <MetricCard
              label="Penjualan"
              value={rupiahCompact(metrics.sales)}
              delta={metrics.salesPctDiff}
              tint="#ECFEFF"
            />
            <MetricCard
              label="Pesanan"
              value={nf.format(metrics.orders ?? 0)}
              delta={metrics.ordersPctDiff}
              tint="#EEF6FF"
            />
            <MetricCard
              label="Terjual"
              value={nf.format(metrics.units ?? 0)}
              delta={metrics.unitsPctDiff}
              tint="#F3F0FF"
            />
            <MetricCard
              label="Konversi"
              value={percent(metrics.conversionRate)}
              delta={metrics.conversionRatePctDiff}
              tint="#FFF4EC"
            />
          </SimpleGrid>

          {series.length > 1 ? (
            <div>
              <Text fw={700} fz="sm" mb="xs">
                Tren Penjualan
              </Text>
              <AreaChart
                h={220}
                data={series}
                dataKey="label"
                series={[{ name: "Penjualan", color: "cyan.6" }]}
                curveType="natural"
                withGradient
                withDots={false}
                gridAxis="y"
                valueFormatter={(value) => rupiahCompact(value)}
              />
            </div>
          ) : null}

          <div>
            <Text fw={700} fz="sm" mb="xs">
              Produk Terlaris
            </Text>
            {topProducts.length === 0 ? (
              <Text c="dimmed" fz="sm">
                Belum ada data produk untuk periode ini.
              </Text>
            ) : (
              <Stack gap="sm">
                {topProducts.map((product, index) => (
                  <Group key={product.itemId ?? index} gap="sm" wrap="nowrap">
                    <Text className="num" fw={800} c="cyan.7" w={20} ta="center">
                      {index + 1}
                    </Text>
                    {product.image && product.image.startsWith("http") ? (
                      <Box
                        w={40}
                        h={40}
                        style={{
                          flexShrink: 0,
                          borderRadius: 8,
                          backgroundImage: `url(${product.image})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      />
                    ) : (
                      <Center w={40} h={40} style={{ flexShrink: 0, borderRadius: 8, background: "#F1F5F9" }}>
                        <IconPhoto size={16} color="#94A3B8" />
                      </Center>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text fz={13.5} fw={600} lineClamp={1}>
                        {product.itemName ?? `Produk ${product.itemId ?? ""}`}
                      </Text>
                      <Text className="num" fz={12} c="dimmed">
                        {nf.format(product.units ?? 0)} terjual · {nf.format(product.productImpression ?? 0)} dilihat
                      </Text>
                    </div>
                    <Badge className="num" variant="light" color="cyan" radius="sm">
                      {rupiahCompact(product.sales)}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            )}
          </div>
        </Stack>
      )}
    </Card>
  )
}
