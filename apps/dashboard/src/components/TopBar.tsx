import { Button, Group, Text } from "@mantine/core"
import { IconPlus, IconRefresh } from "@tabler/icons-react"

export function TopBar({
  onRefresh,
  onConnect,
  refreshing,
}: {
  onRefresh: () => void
  onConnect: () => void
  refreshing: boolean
}) {
  return (
    <Group h="100%" px="lg" gap="lg" wrap="nowrap" style={{ background: "#fff" }}>
      <div style={{ flexShrink: 0 }}>
        <Text fw={800} fz={19} lh={1.15}>
          Dashboard
        </Text>
        <Text fz={12.5} fw={600} c="dimmed">
          Ringkasan toko &amp; katalog yang terhubung
        </Text>
      </div>

      <Group gap="sm" wrap="nowrap" style={{ marginLeft: "auto" }}>
        <Button
          variant="default"
          size="md"
          radius="md"
          leftSection={<IconRefresh size={17} />}
          onClick={onRefresh}
          loading={refreshing}
        >
          Muat ulang
        </Button>
        <Button
          size="md"
          radius="md"
          color="cyan"
          leftSection={<IconPlus size={17} stroke={2.4} />}
          onClick={onConnect}
        >
          Hubungkan toko
        </Button>
      </Group>
    </Group>
  )
}
