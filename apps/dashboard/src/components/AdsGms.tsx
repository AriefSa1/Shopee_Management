import {
  Accordion,
  Alert,
  Card,
  Center,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Text,
} from "@mantine/core"
import { IconInfoCircle } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { type AdsGms as AdsGmsData, api, ApiError } from "../api.ts"

const sections: { key: keyof AdsGmsData["raw"]; api: string }[] = [
  { key: "campaignPerformance", api: "get_gms_campaign_performance" },
  { key: "itemPerformance", api: "get_gms_item_performance" },
  { key: "deletedItems", api: "list_gms_user_deleted_item" },
]

function RawBlock({ value }: { value: unknown }) {
  return (
    <ScrollArea.Autosize mah={340} type="auto">
      <Text
        component="pre"
        className="num"
        fz={12}
        style={{ margin: 0, whiteSpace: "pre", lineHeight: 1.5 }}
      >
        {JSON.stringify(value ?? null, null, 2)}
      </Text>
    </ScrollArea.Autosize>
  )
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

  return (
    <Card radius="lg" padding="lg" withBorder>
      <Group justify="space-between" align="flex-start" wrap="wrap" mb="md">
        <div>
          <Text fw={800} fz="lg">
            GMV Max (GMS) — data mentah
          </Text>
          <Text fz="sm" c="dimmed">
            Respons API apa adanya dari get_gms_campaign_performance, get_gms_item_performance &amp;
            list_gms_user_deleted_item.
            {data ? ` Rentang: ${data.startDate} – ${data.endDate}.` : ""}
          </Text>
        </div>
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
        <Accordion multiple defaultValue={sections.map((section) => section.api)} variant="separated">
          {sections.map((section) => (
            <Accordion.Item key={section.api} value={section.api}>
              <Accordion.Control>
                <Text className="num" fz={13.5} fw={700}>
                  {section.api}
                </Text>
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
