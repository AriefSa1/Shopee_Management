import { Badge, Box, Card, Group, Stack, Text, ThemeIcon } from "@mantine/core"
import { IconClock, IconMessage, IconTruck } from "@tabler/icons-react"
import { lowStock, type Task, tasks } from "../data.ts"

const taskIcon = {
  truck: IconTruck,
  clock: IconClock,
  chat: IconMessage,
} as const

function TaskRow({ task }: { task: Task }) {
  const Icon = taskIcon[task.icon]
  return (
    <Group gap={12} p={11} wrap="nowrap" style={{ borderRadius: 12, background: task.bg }}>
      <ThemeIcon size={34} radius="md" variant="transparent" style={{ background: "#ffffff88" }}>
        <Icon size={17} color={task.color} />
      </ThemeIcon>
      <Text fz={13.5} fw={600} c="#334155">
        {task.label}
      </Text>
      <Text className="num" fz={16} fw={800} style={{ marginLeft: "auto", color: task.color }}>
        {task.count}
      </Text>
    </Group>
  )
}

export function SidePanels() {
  return (
    <Stack gap="lg">
      <Card radius="lg" padding="lg" withBorder>
        <Text fw={800} fz="md" mb="sm">
          Perlu Tindakan
        </Text>
        <Stack gap={10}>
          {tasks.map((task) => (
            <TaskRow key={task.label} task={task} />
          ))}
        </Stack>
      </Card>

      <Card radius="lg" padding="lg" withBorder>
        <Group justify="space-between" mb="sm">
          <Text fw={800} fz="md">
            Stok Menipis
          </Text>
          <Badge color="red" variant="light" radius="sm">
            {lowStock.length} produk
          </Badge>
        </Group>
        <Stack gap="md">
          {lowStock.map((item) => (
            <Group key={item.sku} gap={12} wrap="nowrap">
              <Box w={38} h={38} style={{ borderRadius: 10, background: "#F1F5F9", flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <Text fz={13.5} fw={700} truncate>
                  {item.name}
                </Text>
                <Text className="num" fz={12} c="dimmed">
                  SKU {item.sku}
                </Text>
              </div>
              <Text
                className="num"
                fz={13.5}
                fw={800}
                style={{ marginLeft: "auto", color: item.critical ? "#B91C1C" : "#CA8A04" }}
              >
                {item.left} pcs
              </Text>
            </Group>
          ))}
        </Stack>
      </Card>
    </Stack>
  )
}
