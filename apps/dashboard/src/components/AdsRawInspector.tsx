import {
  Accordion,
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Text,
} from "@mantine/core"
import { IconInfoCircle } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { type AdsRaw, type AdsRawResponses, api, ApiError, type Store, storeLabel } from "../api.ts"
import { type DateRange, toShopeeDate } from "./RangePicker.tsx"

const apiSections: { key: keyof AdsRawResponses; api: string; note: string }[] = [
  { key: "totalBalance", api: "get_total_balance", note: "Saldo kredit iklan (real-time)" },
  { key: "shopToggleInfo", api: "get_shop_toggle_info", note: "Status toggle iklan toko" },
  { key: "gmsEligibility", api: "check_create_gms_product_campaign_eligibility", note: "Kelayakan membuat kampanye GMS" },
  { key: "recommendedItemList", api: "get_recommended_item_list", note: "Rekomendasi SKU untuk diiklankan" },
  { key: "recommendedKeywordList", api: "get_recommended_keyword_list", note: "Rekomendasi kata kunci (per item referensi)" },
  { key: "budgetSuggestion", api: "get_create_product_ad_budget_suggestion", note: "Saran budget (product_selection=auto)" },
  { key: "recommendedRoiTarget", api: "get_product_recommended_roi_target", note: "Saran target ROI (per item referensi)" },
  { key: "dailyPerformance", api: "get_all_cpc_ads_daily_performance", note: "Performa CPC harian (rentang tanggal)" },
  { key: "cpcHourlyPerformance", api: "get_all_cpc_ads_hourly_performance", note: "Performa CPC per jam (tanggal akhir)" },
  { key: "productCampaignIdList", api: "get_product_level_campaign_id_list", note: "Daftar ID kampanye produk" },
  { key: "productCampaignSettingInfo", api: "get_product_level_campaign_setting_info", note: "Setelan kampanye produk" },
  { key: "productCampaignDailyPerformance", api: "get_product_campaign_daily_performance", note: "Performa kampanye produk harian" },
  { key: "productCampaignHourlyPerformance", api: "get_product_campaign_hourly_performance", note: "Performa kampanye produk per jam" },
  { key: "gmsCampaignPerformance", api: "get_gms_campaign_performance", note: "Performa kampanye GMV Max" },
  { key: "gmsItemPerformance", api: "get_gms_item_performance", note: "Performa item GMV Max" },
  { key: "gmsDeletedItem", api: "list_gms_user_deleted_item", note: "Item GMV Max yang dihapus" },
]

function RawBlock({ value }: { value: unknown }) {
  const empty = value === null || value === undefined
  return (
    <ScrollArea.Autosize mah={360} type="auto">
      <Text
        component="pre"
        className="num"
        fz={12}
        style={{ margin: 0, whiteSpace: "pre", lineHeight: 1.5 }}
      >
        {empty ? "// tidak ada data" : JSON.stringify(value, null, 2)}
      </Text>
    </ScrollArea.Autosize>
  )
}

export function AdsRawInspector({
  stores,
  activeShopId,
  onShopChange,
  connectionReady,
  range,
  refreshTick,
}: {
  stores: Store[]
  activeShopId: string | null
  onShopChange: (shopId: string) => void
  connectionReady: boolean
  range: DateRange
  refreshTick: number
}) {
  const [data, setData] = useState<AdsRaw | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [start, end] = range

  useEffect(() => {
    if (activeShopId === null || !connectionReady || start === null || end === null) {
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .adsRaw(activeShopId, toShopeeDate(start), toShopeeDate(end))
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
  }, [activeShopId, connectionReady, start, end, refreshTick])

  return (
    <Card radius="lg" padding="lg" withBorder>
      <Group justify="space-between" align="flex-start" wrap="wrap" mb="md">
        <div>
          <Text fw={800} fz="lg">
            Inspektur Data Mentah API Ads
          </Text>
          <Text fz="sm" c="dimmed">
            Respons API apa adanya untuk menentukan field mana yang akan ditampilkan di UI.
            {data ? ` Rentang: ${data.startDate} – ${data.endDate}.` : ""}
          </Text>
        </div>
        <Select
          aria-label="Pilih toko"
          data={stores.map((store) => ({ value: store.id, label: storeLabel(store) }))}
          value={activeShopId}
          onChange={(value) => value && onShopChange(value)}
          placeholder="Pilih toko"
          allowDeselect={false}
          w={200}
          disabled={stores.length === 0}
        />
      </Group>

      {activeShopId === null || !connectionReady ? (
        <Text c="dimmed" fz="sm" ta="center" py="lg">
          Hubungkan toko dengan token siap untuk memuat respons API.
        </Text>
      ) : loading ? (
        <Center py="lg">
          <Loader size="sm" />
        </Center>
      ) : error ? (
        <Alert color="orange" icon={<IconInfoCircle size={18} />}>
          Gagal memuat data mentah ({error}). Periksa izin Ads untuk toko ini.
        </Alert>
      ) : data ? (
        <Accordion multiple variant="separated">
          {apiSections.map((section) => (
            <Accordion.Item key={section.api} value={section.api}>
              <Accordion.Control>
                <Stack gap={2}>
                  <Group gap="xs">
                    <Text className="num" fz={13.5} fw={700}>
                      {section.api}
                    </Text>
                    <Badge size="xs" variant="light" color="gray">
                      raw
                    </Badge>
                  </Group>
                  <Text fz={12} c="dimmed">
                    {section.note}
                  </Text>
                </Stack>
              </Accordion.Control>
              <Accordion.Panel>
                <RawBlock value={data.raw[section.key]} />
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      ) : null}
    </Card>
  )
}
