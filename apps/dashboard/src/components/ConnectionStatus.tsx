import { Badge, Card, Group, Stack, Text } from "@mantine/core"
import { type Connection, connectionStateMetaOf, type Store, storeLabel } from "../api.ts"

export function ConnectionStatus({
  stores,
  connections,
}: {
  stores: Store[]
  connections: Connection[]
}) {
  const connectionByShop = new Map(connections.map((connection) => [connection.shopId, connection]))

  return (
    <Card radius="lg" padding="lg" withBorder>
      <Text fw={800} fz="md" mb="sm">
        Status Koneksi Toko
      </Text>

      {stores.length === 0 ? (
        <Text fz="sm" c="dimmed">
          Belum ada toko terhubung.
        </Text>
      ) : (
        <Stack gap="sm">
          {stores.map((store) => {
            const connection = connectionByShop.get(store.id)
            const meta = connection ? connectionStateMetaOf(connection.state) : undefined
            return (
              <Group key={store.id} justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text fz={13.5} fw={700} truncate>
                    {storeLabel(store)}
                  </Text>
                  <Text className="num" fz={12} c="dimmed">
                    ID {store.externalShopId} · {store.market}
                  </Text>
                </div>
                <Badge color={meta?.color ?? "gray"} variant="light" radius="sm">
                  {meta?.label ?? "Tidak diketahui"}
                </Badge>
              </Group>
            )
          })}
        </Stack>
      )}
    </Card>
  )
}
