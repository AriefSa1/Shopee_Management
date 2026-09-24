import { ActionIcon, Button, Group, Indicator, Input, Text } from "@mantine/core"
import { IconBell, IconCalendar, IconChevronDown, IconPlus, IconSearch } from "@tabler/icons-react"

export function TopBar() {
  return (
    <Group h="100%" px="lg" gap="lg" wrap="nowrap" style={{ background: "#fff" }}>
      <div style={{ flexShrink: 0 }}>
        <Text fw={800} fz={19} lh={1.15}>
          Dashboard
        </Text>
        <Text fz={12.5} fw={600} c="dimmed">
          Ringkasan penjualan semua channel
        </Text>
      </div>

      <Input
        flex={1}
        maw={420}
        size="md"
        radius="md"
        placeholder="Cari pesanan, produk, atau SKU…"
        leftSection={<IconSearch size={18} />}
        styles={{ input: { background: "#F8FAFC" } }}
        aria-label="Cari"
      />

      <Button
        variant="default"
        size="md"
        radius="md"
        leftSection={<IconCalendar size={17} />}
        rightSection={<IconChevronDown size={15} />}
      >
        7 hari terakhir
      </Button>

      <Indicator color="orange" size={9} offset={6} withBorder>
        <ActionIcon variant="default" size={42} radius="md" aria-label="Notifikasi">
          <IconBell size={19} stroke={1.8} />
        </ActionIcon>
      </Indicator>

      <Button size="md" radius="md" color="cyan" leftSection={<IconPlus size={17} stroke={2.4} />}>
        Tambah Produk
      </Button>
    </Group>
  )
}
