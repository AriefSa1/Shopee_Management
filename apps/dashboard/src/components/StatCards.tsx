import { Card, Group, SimpleGrid, Skeleton, Text, ThemeIcon } from "@mantine/core"
import { IconBox, IconBuildingStore, IconEye, IconShoppingBag } from "@tabler/icons-react"

export type KpiValues = {
  storeCount: number
  readyCount: number
  productCount: number
  totalSold: number
  totalViews: number
}

const nf = new Intl.NumberFormat("id-ID")

function KpiCard({
  label,
  value,
  sub,
  icon,
  color,
  tint,
  loading,
}: {
  label: string
  value: string
  sub: string
  icon: typeof IconBox
  color: string
  tint: string
  loading: boolean
}) {
  const Icon = icon
  return (
    <Card radius="lg" padding="lg" withBorder>
      <Group justify="space-between">
        <Text fz="sm" fw={600} c="dimmed">
          {label}
        </Text>
        <ThemeIcon size={34} radius="md" variant="light" style={{ background: tint }}>
          <Icon size={17} color={color} />
        </ThemeIcon>
      </Group>
      {loading ? (
        <Skeleton height={30} width="60%" mt={12} radius="sm" />
      ) : (
        <Text className="num" fz={27} fw={700} mt={10}>
          {value}
        </Text>
      )}
      <Text fz={12} c="dimmed" mt={8}>
        {sub}
      </Text>
    </Card>
  )
}

export function StatCards({ values, loading }: { values: KpiValues; loading: boolean }) {
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="lg">
      <KpiCard
        label="Toko Terhubung"
        value={nf.format(values.storeCount)}
        sub={`${values.readyCount}/${values.storeCount} token siap`}
        icon={IconBuildingStore}
        color="#0E7490"
        tint="#ECFEFF"
        loading={loading}
      />
      <KpiCard
        label="Produk (toko aktif)"
        value={nf.format(values.productCount)}
        sub="dari katalog Shopee"
        icon={IconBox}
        color="#2563EB"
        tint="#EEF6FF"
        loading={loading}
      />
      <KpiCard
        label="Total Terjual"
        value={nf.format(values.totalSold)}
        sub="akumulasi item toko aktif"
        icon={IconShoppingBag}
        color="#7C3AED"
        tint="#F3F0FF"
        loading={loading}
      />
      <KpiCard
        label="Total Dilihat"
        value={nf.format(values.totalViews)}
        sub="akumulasi tayangan"
        icon={IconEye}
        color="#EA580C"
        tint="#FFF4EC"
        loading={loading}
      />
    </SimpleGrid>
  )
}
