import { Badge, Box, Group, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core"
import {
  IconBox,
  IconBuildingStore,
  IconChartBar,
  IconChevronDown,
  IconLayoutGrid,
  IconPlus,
  IconReportAnalytics,
  IconShoppingCart,
  IconStack2,
} from "@tabler/icons-react"
import { channelMeta } from "../data.ts"

type NavItem = {
  icon: typeof IconLayoutGrid
  label: string
  active?: boolean
  badge?: number
}

const items: NavItem[] = [
  { icon: IconLayoutGrid, label: "Dashboard", active: true },
  { icon: IconShoppingCart, label: "Pesanan", badge: 28 },
  { icon: IconBox, label: "Produk" },
  { icon: IconStack2, label: "Stok Gudang" },
  { icon: IconReportAnalytics, label: "Listing" },
  { icon: IconChartBar, label: "Analitik" },
  { icon: IconBuildingStore, label: "Channel" },
]

const stores: { label: string; channel: keyof typeof channelMeta }[] = [
  { label: "Shopee · NinetyFour", channel: "shopee" },
  { label: "Tokopedia · 94Media", channel: "tokopedia" },
  { label: "TikTok Shop · 94", channel: "tiktok" },
]

export function Sidebar() {
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
            <UnstyledButton
              key={item.label}
              className="navitem"
              data-active={item.active || undefined}
            >
              <Group gap={12} wrap="nowrap">
                <item.icon size={19} stroke={1.8} />
                <Text fz="sm" fw={item.active ? 700 : 600} style={{ flex: 1 }}>
                  {item.label}
                </Text>
                {item.badge ? (
                  <Badge size="sm" color="orange" circle variant="filled" className="num">
                    {item.badge}
                  </Badge>
                ) : null}
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
          {stores.map((store) => (
            <Group key={store.label} gap={10} px={10} py={6} wrap="nowrap">
              <Box w={9} h={9} style={{ borderRadius: 3, background: channelMeta[store.channel].color }} />
              <Text fz={13} fw={600} c="#334155">
                {store.label}
              </Text>
            </Group>
          ))}
          <UnstyledButton px={10} py={6}>
            <Group gap={8} c="cyan.7">
              <IconPlus size={16} stroke={2.2} />
              <Text fz={13} fw={700}>
                Hubungkan toko
              </Text>
            </Group>
          </UnstyledButton>
        </Stack>
      </div>

      <Group
        mt="auto"
        gap={10}
        p="xs"
        wrap="nowrap"
        style={{ borderRadius: 12, background: "#F8FAFC", border: "1px solid #EEF2F6" }}
      >
        <ThemeIcon size={34} radius="md" color="dark" variant="filled">
          <Text fz={13} fw={700}>
            AS
          </Text>
        </ThemeIcon>
        <div style={{ lineHeight: 1.2 }}>
          <Text fz={13} fw={700}>
            Arief S.
          </Text>
          <Text fz={11} fw={600} c="dimmed">
            Owner
          </Text>
        </div>
        <IconChevronDown size={16} style={{ marginLeft: "auto", color: "#94A3B8" }} />
      </Group>
    </Stack>
  )
}
