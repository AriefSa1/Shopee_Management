import { Anchor, Badge, Box, Card, Group, Table, Text } from "@mantine/core"
import { channelMeta, orderStatusMeta, recentOrders } from "../data.ts"

export function RecentOrders() {
  return (
    <Card radius="lg" padding="lg" withBorder>
      <Group justify="space-between" mb="xs">
        <Text fw={800} fz="md">
          Pesanan Terbaru
        </Text>
        <Anchor fz={13} fw={700} c="cyan.7">
          Lihat semua
        </Anchor>
      </Group>

      <Table verticalSpacing="sm" horizontalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Pesanan</Table.Th>
            <Table.Th>Channel</Table.Th>
            <Table.Th>Total</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {recentOrders.map((order) => {
            const channel = channelMeta[order.channel]
            const status = orderStatusMeta[order.status]
            return (
              <Table.Tr key={order.id}>
                <Table.Td>
                  <Text className="num" fz={13.5} fw={700}>
                    {order.id}
                  </Text>
                  <Text fz={12} c="dimmed">
                    {order.customer} · {order.items} item
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Box w={8} h={8} style={{ borderRadius: 2, background: channel.color }} />
                    <Text fz={13} fw={600} c="#334155">
                      {channel.label}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text className="num" fz={13.5} fw={700}>
                    {order.total}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={status.color} variant="light" radius="sm">
                    {status.label}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Card>
  )
}
