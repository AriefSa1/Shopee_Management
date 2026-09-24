import { Alert, Badge, Card, Center, Group, Loader, SegmentedControl, Table, Text } from "@mantine/core"
import { IconInfoCircle } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { type AdsAdType, type AdsProductCampaign, api, ApiError } from "../api.ts"

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

const statusColor: Record<string, string> = {
  ongoing: "green",
  scheduled: "blue",
  paused: "yellow",
  ended: "gray",
  closed: "gray",
  deleted: "red",
}

function budgetLabel(value: number | undefined): string {
  if (value === undefined) return "—"
  if (value === 0) return "Tak terbatas"
  return rupiah.format(value)
}

function CampaignRow({ campaign }: { campaign: AdsProductCampaign }) {
  return (
    <Table.Tr>
      <Table.Td>
        <Text fz={13.5} fw={650} lineClamp={1}>
          {campaign.adName ?? `Kampanye ${campaign.campaignId}`}
        </Text>
        <Text className="num" fz={11.5} c="dimmed">
          ID {campaign.campaignId}
        </Text>
      </Table.Td>
      <Table.Td>
        <Badge size="sm" variant="light" color={campaign.adType === "auto" ? "cyan" : "grape"}>
          {campaign.adType ?? "—"}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Badge size="sm" variant="light" color={statusColor[campaign.campaignStatus ?? ""] ?? "gray"}>
          {campaign.campaignStatus ?? "—"}
        </Badge>
      </Table.Td>
      <Table.Td>{campaign.campaignPlacement ?? "—"}</Table.Td>
      <Table.Td className="num">{budgetLabel(campaign.campaignBudget)}</Table.Td>
      <Table.Td className="num">
        {campaign.roasTarget === undefined ? "—" : `${campaign.roasTarget.toFixed(2).replace(".", ",")}×`}
      </Table.Td>
      <Table.Td className="num">{campaign.itemIds.length}</Table.Td>
    </Table.Tr>
  )
}

export function AdsProductCampaigns({
  shopId,
  connectionReady,
  refreshTick,
}: {
  shopId: string | null
  connectionReady: boolean
  refreshTick: number
}) {
  const [adType, setAdType] = useState<AdsAdType>("all")
  const [campaigns, setCampaigns] = useState<AdsProductCampaign[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (shopId === null || !connectionReady) {
      setCampaigns(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .adsProductCampaigns(shopId, adType)
      .then((result) => {
        if (!cancelled) setCampaigns(result.campaigns)
      })
      .catch((cause) => {
        if (!cancelled) {
          setCampaigns(null)
          setError(cause instanceof ApiError ? cause.code : "error")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shopId, connectionReady, adType, refreshTick])

  return (
    <Card radius="lg" padding="lg" withBorder>
      <Group justify="space-between" align="flex-start" wrap="wrap" mb="md">
        <div>
          <Text fw={800} fz="lg">
            Kampanye Produk
          </Text>
          <Text fz="sm" c="dimmed">
            Dari get_product_level_campaign_id_list &amp; get_product_level_campaign_setting_info.
          </Text>
        </div>
        <SegmentedControl
          aria-label="Tipe kampanye"
          size="xs"
          data={[
            { label: "Semua", value: "all" },
            { label: "Otomatis", value: "auto" },
            { label: "Manual", value: "manual" },
          ]}
          value={adType}
          onChange={(value) => setAdType(value as AdsAdType)}
        />
      </Group>

      {shopId === null || !connectionReady ? (
        <Text c="dimmed" fz="sm" ta="center" py="lg">
          Hubungkan toko dengan token siap untuk memuat kampanye.
        </Text>
      ) : loading ? (
        <Center py="lg">
          <Loader size="sm" />
        </Center>
      ) : error ? (
        <Alert color="orange" icon={<IconInfoCircle size={18} />}>
          Kampanye belum tersedia ({error}). Pastikan izin Ads untuk toko ini.
        </Alert>
      ) : campaigns && campaigns.length > 0 ? (
        <Table.ScrollContainer minWidth={720}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Kampanye</Table.Th>
                <Table.Th>Tipe</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Penempatan</Table.Th>
                <Table.Th>Budget</Table.Th>
                <Table.Th>Target ROAS</Table.Th>
                <Table.Th>Produk</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {campaigns.map((campaign) => (
                <CampaignRow key={campaign.campaignId} campaign={campaign} />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Text c="dimmed" fz="sm" ta="center" py="lg">
          Belum ada kampanye produk untuk toko ini.
        </Text>
      )}
    </Card>
  )
}
