import { AreaChart } from "@mantine/charts"
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core"
import { IconAd, IconExternalLink, IconInfoCircle, IconSearch } from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { ADS_ENDPOINTS, adsDocumentationUrl } from "../ads-catalog.ts"
import { api, ApiError, type AdsDaily, type AdsDailyRow, type Connection, type Store, storeLabel } from "../api.ts"

const areas = ["Akun", "Rekomendasi", "Performa", "Iklan Produk", "GMV Max"] as const
const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat("id-ID")

function total(rows: AdsDailyRow[], field: "expense" | "direct_gmv" | "clicks" | "impression"): number | undefined {
  const present = rows.filter((row) => row[field] !== undefined)
  return present.length === 0 ? undefined : present.reduce((sum, row) => sum + (row[field] ?? 0), 0)
}

export function AdsWorkspace({
  stores,
  connections,
  activeShopId,
  onShopChange,
  onConnect,
  refreshTick,
}: {
  stores: Store[]
  connections: Connection[]
  activeShopId: string | null
  onShopChange: (shopId: string) => void
  onConnect: () => void
  refreshTick: number
}) {
  const [query, setQuery] = useState("")
  const [operation, setOperation] = useState("Semua")
  const [days, setDays] = useState<7 | 14 | 28>(7)
  const [data, setData] = useState<{ days: 7 | 14 | 28; payload: AdsDaily } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeStore = stores.find((store) => store.id === activeShopId)
  const connection = connections.find((item) => item.shopId === activeShopId)
  const connectionReady = connection?.state === "ready"
  const visibleData = data?.days === days && data.payload.shopId === activeShopId ? data.payload : null

  useEffect(() => {
    if (activeShopId === null || !connectionReady) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setData(null)
    setLoading(true)
    setError(null)
    api.adsDaily(activeShopId, days)
      .then((result) => { if (!cancelled) setData({ days, payload: result }) })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.code : "error")
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeShopId, connectionReady, days, refreshTick])

  const expense = visibleData ? total(visibleData.daily, "expense") : undefined
  const gmv = visibleData ? total(visibleData.daily, "direct_gmv") : undefined
  const clicks = visibleData ? total(visibleData.daily, "clicks") : undefined
  const roas = expense !== undefined && gmv !== undefined && expense > 0 ? gmv / expense : undefined
  const overviewMetrics = [
    { label: "Biaya iklan", value: expense === undefined ? "—" : rupiah.format(expense) },
    { label: "GMV langsung", value: gmv === undefined ? "—" : rupiah.format(gmv) },
    { label: "ROAS langsung", value: roas === undefined ? "—" : `${roas.toFixed(2).replace(".", ",")}×` },
    { label: "Klik", value: clicks === undefined ? "—" : integer.format(clicks) },
  ]
  const chartData = (visibleData?.daily ?? []).map((row) => ({
    date: row.date,
    Biaya: row.expense ?? null,
    GMV: row.direct_gmv ?? null,
  }))
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("id-ID")
    return ADS_ENDPOINTS.filter(
      (endpoint) =>
        (operation === "Semua" || endpoint.operation === operation) &&
        (term === "" ||
          endpoint.name.toLocaleLowerCase("id-ID").includes(term) ||
          endpoint.area.toLocaleLowerCase("id-ID").includes(term)),
    )
  }, [query, operation])

  return (
    <Stack gap="lg">
      <Card radius="lg" padding="lg" withBorder>
        <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
          <div>
            <Group gap="xs">
              <IconAd size={22} color="var(--mantine-color-cyan-7)" aria-hidden="true" />
              <Text fw={800} fz="lg">Ads Shopee</Text>
            </Group>
            <Text fz="sm" c="dimmed" mt={4}>
              Ruang kerja iklan per toko, berdasarkan modul Ads di Shopee Open Platform.
            </Text>
          </div>
          <Select
            aria-label="Pilih toko untuk Ads"
            data={stores.map((store) => ({ value: store.id, label: storeLabel(store) }))}
            value={activeShopId}
            onChange={(value) => value && onShopChange(value)}
            placeholder="Pilih toko"
            allowDeselect={false}
            w="var(--ads-select-width)"
          />
        </Group>

        <Alert color={activeStore ? "cyan" : "orange"} icon={<IconInfoCircle size={18} />} mt="lg">
          {activeStore === undefined ? (
            <Group justify="space-between" gap="sm">
              <Text fz="sm">Hubungkan toko untuk menyiapkan ruang kerja Ads.</Text>
              <Button size="xs" variant="light" onClick={onConnect}>Hubungkan toko</Button>
            </Group>
          ) : (
            <Text fz="sm">
              {storeLabel(activeStore)}: {connectionReady ? "token toko siap" : "koneksi toko belum siap"}.
              Ringkasan memakai API performa CPC harian; 24 entri lain tercantum di bawah sesuai status ketersediaannya.
            </Text>
          )}
        </Alert>
      </Card>

      <Card radius="lg" padding="lg" withBorder aria-busy={loading}>
        <Group justify="space-between" align="flex-start" wrap="wrap" mb="md">
          <div>
            <Text fw={800} fz="lg">Performa Iklan</Text>
            <Text fz="sm" c="dimmed">
              {visibleData ? "Performa CPC harian dari Shopee untuk toko terpilih." : "Ringkasan akan terisi setelah API Ads tersambung."}
            </Text>
          </div>
          <SegmentedControl
            aria-label="Periode performa Ads"
            data={[{ label: "7 hari", value: "7" }, { label: "14 hari", value: "14" }, { label: "28 hari", value: "28" }]}
            value={String(days)}
            onChange={(value) => setDays(Number(value) as 7 | 14 | 28)}
            size="xs"
          />
        </Group>
        <Text role="status" aria-live="polite" fz="xs" c="dimmed" mb="sm">
          {loading
            ? "Memuat performa iklan."
            : error
              ? `Performa iklan belum tersedia: ${error}.`
              : visibleData
                ? `Performa iklan untuk ${visibleData.startDate} sampai ${visibleData.endDate} siap.`
                : "Performa iklan belum tersedia untuk toko terpilih."}
        </Text>
        {loading ? <Center py="md"><Loader size="sm" /></Center> : null}
        {error ? (
          <Alert color="orange" icon={<IconInfoCircle size={18} />} mb="md">
            Data Ads belum tersedia ({error}). Periksa izin Ads untuk toko ini dan respons Shopee.
          </Alert>
        ) : null}
        {visibleData?.partial ? (
          <Alert color="yellow" icon={<IconInfoCircle size={18} />} mb="md">
            Shopee memberi peringatan bahwa data periode ini mungkin belum lengkap.
          </Alert>
        ) : null}
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
          {overviewMetrics.map((metric) => (
            <Card key={metric.label} padding="md" radius="md" withBorder bg="gray.0">
              <Text fz="xs" fw={700} c="dimmed">{metric.label}</Text>
              <Text className="num" fz="xl" fw={800} mt="xs">{metric.value}</Text>
              <Text fz="xs" c="dimmed">{visibleData ? `${visibleData.startDate} – ${visibleData.endDate}` : "Belum tersedia"}</Text>
            </Card>
          ))}
        </SimpleGrid>
        {visibleData && visibleData.daily.length === 0 ? (
          <Text fz="sm" c="dimmed" ta="center" py="lg">Tidak ada data iklan untuk periode ini.</Text>
        ) : null}
        {visibleData && visibleData.daily.length > 0 ? (
          <Stack gap="md" mt="lg">
            {chartData.length > 1 ? (
              <div
                role="img"
                aria-label="Tren biaya iklan dan GMV langsung per hari"
                aria-describedby="ads-daily-table-caption"
              >
                <AreaChart
                  h="var(--ads-chart-height)"
                  data={chartData}
                  dataKey="date"
                  series={[{ name: "Biaya", color: "cyan.6" }, { name: "GMV", color: "blue.6" }]}
                  withLegend
                  valueFormatter={(value) => rupiah.format(value)}
                />
              </div>
            ) : null}
            <Table.ScrollContainer minWidth="var(--ads-table-min-width)">
              <Table striped highlightOnHover>
                <Table.Caption id="ads-daily-table-caption">Rincian performa CPC harian dari Shopee</Table.Caption>
                <Table.Thead><Table.Tr>
                  <Table.Th>Tanggal</Table.Th><Table.Th>Biaya</Table.Th><Table.Th>GMV langsung</Table.Th>
                  <Table.Th>Klik</Table.Th><Table.Th>Impresi</Table.Th>
                </Table.Tr></Table.Thead>
                <Table.Tbody>
                  {visibleData.daily.map((row) => (
                    <Table.Tr key={row.date}>
                      <Table.Td>{row.date}</Table.Td>
                      <Table.Td>{row.expense === undefined ? "—" : rupiah.format(row.expense)}</Table.Td>
                      <Table.Td>{row.direct_gmv === undefined ? "—" : rupiah.format(row.direct_gmv)}</Table.Td>
                      <Table.Td>{row.clicks === undefined ? "—" : integer.format(row.clicks)}</Table.Td>
                      <Table.Td>{row.impression === undefined ? "—" : integer.format(row.impression)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        ) : null}
      </Card>

      <Card radius="lg" padding="lg" withBorder>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md" mb="lg">
          <div>
            <Text fw={800} fz="lg">Cakupan API Ads</Text>
            <Text fz="sm" c="dimmed">
              25 endpoint terdokumentasi: 17 baca dan 8 aksi. Dua API iklan otomatis ditandai akan dinonaktifkan oleh Shopee.
            </Text>
          </div>
          <Badge color="cyan" variant="light">Dokumentasi resmi</Badge>
        </Group>

        <Group gap="sm" align="end" mb="lg" wrap="wrap">
          <TextInput
            aria-label="Cari API Ads"
            placeholder="Cari nama API atau kategori"
            leftSection={<IconSearch size={16} />}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            style={{ flex: "1 1 var(--ads-search-min-width)" }}
          />
          <SegmentedControl
            aria-label="Filter jenis API Ads"
            data={["Semua", "Baca", "Aksi"]}
            value={operation}
            onChange={setOperation}
          />
        </Group>

        {filtered.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">Tidak ada API yang cocok dengan pencarian.</Text>
        ) : (
          <Stack gap="lg">
            {areas.map((area) => {
              const endpoints = filtered.filter((endpoint) => endpoint.area === area)
              if (endpoints.length === 0) return null
              return (
                <section key={area} aria-label={`API ${area}`}>
                  <Group gap="xs" mb="xs">
                    <Text fw={750} fz="sm">{area}</Text>
                    <Badge size="sm" variant="light" color="gray">{endpoints.length}</Badge>
                  </Group>
                  <Stack gap="xs">
                    {endpoints.map((endpoint) => (
                      <Group
                        key={endpoint.name}
                        justify="space-between"
                        gap="sm"
                        wrap="wrap"
                        px="md"
                        py="sm"
                        className="ads-endpoint"
                      >
                        <div style={{ minWidth: 0 }}>
                          <Text className="ads-endpoint-name" fz="sm" fw={650}>{endpoint.name}</Text>
                          <Group gap={6} mt={4}>
                            <Badge size="xs" color={endpoint.operation === "Baca" ? "cyan" : "orange"} variant="light">
                              {endpoint.operation}
                            </Badge>
                            {endpoint.offline ? (
                              <Badge size="xs" color="gray" variant="light">Coming offline soon</Badge>
                            ) : null}
                            {endpoint.unavailable ? (
                              <Badge size="xs" color="red" variant="light">Tidak untuk Seller In House</Badge>
                            ) : null}
                          </Group>
                        </div>
                        <Anchor
                          href={adsDocumentationUrl(endpoint.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          fz="sm"
                          fw={700}
                          aria-label={`Buka dokumentasi ${endpoint.name}`}
                        >
                          <Group gap={4} wrap="nowrap">Dokumentasi <IconExternalLink size={14} /></Group>
                        </Anchor>
                      </Group>
                    ))}
                  </Stack>
                </section>
              )
            })}
          </Stack>
        )}
      </Card>
    </Stack>
  )
}
