import { Badge, Box, Group, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core"
import {
  IconBox,
  IconBuildingStore,
  IconChartBar,
  IconLayoutGrid,
  IconLogout,
  IconPlus,
  IconReportAnalytics,
  IconShoppingCart,
  IconStack2,
} from "@tabler/icons-react"
import { type Connection, connectionStateMetaOf, type Store, storeLabel } from "../api.ts"

const items = [
  { icon: IconLayoutGrid, label: "Dashboard", active: true },
  { icon: IconShoppingCart, label: "Pesanan" },
  { icon: IconBox, label: "Produk" },
  { icon: IconStack2, label: "Stok Gudang" },
  { icon: IconReportAnalytics, label: "Listing" },
  { icon: IconChartBar, label: "Analitik" },
  { icon: IconBuildingStore, label: "Channel" },
]

export function Sidebar({
  stores,
  connections,
  onConnect,
  onLogout,
}: {
  stores: Store[]
  connections: Connection[]
  onConnect: () => void
  onLogout: () => void
}) {
  const stateByShop = new Map(connections.map((connection) => [connection.shopId, connection.state]))

  return (
    <Stack h="100%" gap="lg" p="md" style={{ background: "#fff" }}>
      <Group gap="sm" px={6}>
        <ThemeIcon size={38} radius="md" color="cyan" variant="filled">
          <IconLayoutGrid size={21} />
        </ThemeIcon>
        <div>
          <Text fw={800} fz="lg" lh={1.1}>
            OmniHub
          </Text>
          <Text fz={10} fw={700} c="dimmed" style={{ letterSpacing: 0.5 }}>
            SELLER CENTER
          </Text>
        </div>
      </Group>

      <div>
        <Text fz={11} fw={700} c="dimmed" px={10} pb={6} style={{ letterSpacing: 0.6 }}>
          MENU
        </Text>
        <Stack gap={3}>
          {items.map((item) => (
            <UnstyledButton key={item.label} className="navitem" data-active={item.active || undefined}>
              <Group gap={12} wrap="nowrap">
                <item.icon size={19} stroke={1.8} />
                <Text fz="sm" fw={item.active ? 700 : 600} style={{ flex: 1 }}>
                  {item.label}
                </Text>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      </div>

      <div>
        <Text fz={11} fw={700} c="dimmed" px={10} pb={8} style={{ letterSpacing: 0.6 }}>
          TOKO TERHUBUNG
        </Text>
        <Stack gap={4}>
          {stores.length === 0 ? (
            <Text fz={12.5} c="dimmed" px={10}>
              Belum ada toko.
            </Text>
          ) : (
            stores.map((store) => {
              const state = stateByShop.get(store.id)
              const meta = state ? connectionStateMetaOf(state) : undefined
              return (
                <Group key={store.id} gap={10} px={10} py={6} wrap="nowrap">
                  <Box
                    w={9}
                    h={9}
                    style={{
                      borderRadius: 3,
                      background: `var(--mantine-color-${meta?.color ?? "gray"}-6)`,
                    }}
                  />
                  <Text fz={13} fw={600} c="#334155" truncate style={{ flex: 1 }}>
                    {storeLabel(store)}
                  </Text>
                </Group>
              )
            })
          )}
          <UnstyledButton px={10} py={6} onClick={onConnect}>
            <Group gap={8} c="cyan.7">
              <IconPlus size={16} stroke={2.2} />
              <Text fz={13} fw={700}>
                Hubungkan toko
              </Text>
            </Group>
          </UnstyledButton>
        </Stack>
      </div>

      <UnstyledButton mt="auto" className="navitem" onClick={onLogout}>
        <Group gap={12} wrap="nowrap">
          <IconLogout size={19} stroke={1.8} />
          <Text fz="sm" fw={600}>
            Keluar
          </Text>
        </Group>
      </UnstyledButton>

      <Badge variant="light" color="gray" radius="sm" style={{ alignSelf: "flex-start" }}>
        Integrasi: Shopee
      </Badge>
    </Stack>
  )
}
