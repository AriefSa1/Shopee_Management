import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core"
import { IconInfoCircle } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { type AdsGms as AdsGmsData, api, ApiError, type GmsReport } from "../api.ts"

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})
const integer = new Intl.NumberFormat("id-ID")

function money(value: number | undefined): string {
  return value === undefined ? "—" : rupiah.format(value)
}
function count(value: number | undefined): string {
  return value === undefined ? "—" : integer.format(value)
}
function ratio(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(2).replace(".", ",")}×`
}

function tiles(report: GmsReport): { label: string; value: string }[] {
  return [
    { label: "Biaya iklan", value: money(report.expense) },
    { label: "GMV (broad)", value: money(report.broadGmv) },
    { label: "ROAS (broad)", value: ratio(report.broadRoi) },
    { label: "Pesanan (broad)", value: count(report.broadOrder) },
    { label: "Klik", value: count(report.clicks) },
  ]
}

export function AdsGms({
  shopId,
  connectionReady,
  refreshTick,
}: {
  shopId: string | null
  connectionReady: boolean
  refreshTick: number
}) {
  const [days, setDays] = useState<7 | 14 | 28>(7)
  const [data, setData] = useState<AdsGmsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (shopId === null || !connectionReady) {
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .adsGms(shopId, days)
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
  }, [shopId, connectionReady, days, refreshTick])

  const topItems = (data?.items ?? [])
    .slice()
    .sort((a, b) => (b.report?.broadGmv ?? 0) - (a.report?.broadGmv ?? 0))
    .slice(0, 10)

  return (
    <Card radius="lg" padding="lg" withBorder>
      <Group justify="space-between" align="flex-start" wrap="wrap" mb="md">
        <div>
          <Text fw={800} fz="lg">
            GMV Max (GMS)
          </Text>
          <Text fz="sm" c="dimmed">
            Dari get_gms_campaign_performance, get_gms_item_performance &amp; list_gms_user_deleted_item.
          </Text>
        </div>
        <Group gap="sm" wrap="nowrap">
          {data ? (
            <Badge variant="light" color="gray">
              {data.deletedCount} item dihapus
            </Badge>
          ) : null}
          <SegmentedControl
            aria-label="Periode GMV Max"
            size="xs"
            data={[
              { label: "7 hari", value: "7" },
              { label: "14 hari", value: "14" },
              { label: "28 hari", value: "28" },
            ]}
            value={String(days)}
            onChange={(value) => setDays(Number(value) as 7 | 14 | 28)}
          />
        </Group>
      </Group>

      {shopId === null || !connectionReady ? (
        <Text c="dimmed" fz="sm" ta="center" py="lg">
          Hubungkan toko dengan token siap untuk memuat data GMV Max.
        </Text>
      ) : loading ? (
        <Center py="lg">
          <Loader size="sm" />
        </Center>
      ) : error ? (
        <Alert color="orange" icon={<IconInfoCircle size={18} />}>
          Data GMV Max belum tersedia ({error}). Fitur ini butuh kampanye GMS aktif dan izin Ads.
        </Alert>
      ) : data ? (
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 2, md: 5 }} spacing="md">
            {tiles(data.report).map((tile) => (
              <Card key={tile.label} padding="md" radius="md" withBorder bg="gray.0">
                <Text fz="xs" fw={700} c="dimmed">
                  {tile.label}
                </Text>
                <Text className="num" fz="lg" fw={800} mt={4}>
                  {tile.value}
                </Text>
              </Card>
            ))}
          </SimpleGrid>

          {topItems.length > 0 ? (
            <div>
              <Text fw={700} fz="sm" mb="xs">
                Produk GMS Teratas
              </Text>
              <Table.ScrollContainer minWidth={560}>
                <Table highlightOnHover verticalSpacing="xs" fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Item ID</Table.Th>
                      <Table.Th>GMV</Table.Th>
                      <Table.Th>Pesanan</Table.Th>
                      <Table.Th>Biaya</Table.Th>
                      <Table.Th>ROAS</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {topItems.map((item, index) => (
                      <Table.Tr key={item.itemId ?? index}>
                        <Table.Td className="num">{item.itemId ?? "—"}</Table.Td>
                        <Table.Td className="num">{money(item.report?.broadGmv)}</Table.Td>
                        <Table.Td className="num">{count(item.report?.broadOrder)}</Table.Td>
                        <Table.Td className="num">{money(item.report?.expense)}</Table.Td>
                        <Table.Td className="num">{ratio(item.report?.broadRoi)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </div>
          ) : (
            <Text c="dimmed" fz="sm" ta="center" py="sm">
              Belum ada performa item GMS untuk periode ini.
            </Text>
          )}
        </Stack>
      ) : null}
    </Card>
  )
}
