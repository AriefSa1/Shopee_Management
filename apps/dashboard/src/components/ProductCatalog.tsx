import { Alert, Badge, Card, Group, Image, Select, Table, Text, TextInput } from "@mantine/core"
import { IconAlertCircle, IconPhoto, IconSearch, IconStar } from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { type Product, type Publication, type Store, storeLabel } from "../api.ts"

const nf = new Intl.NumberFormat("id-ID")

const publicationMeta: Record<Publication, { label: string; color: string }> = {
  active: { label: "Aktif", color: "green" },
  inactive: { label: "Nonaktif", color: "orange" },
  unknown: { label: "Tidak diketahui", color: "gray" },
}

function firstImage(product: Product): string | undefined {
  const raw = product.raw
  if (raw !== null && typeof raw === "object" && "image" in raw) {
    const image = (raw as { image?: unknown }).image
    if (image !== null && typeof image === "object" && "image_url_list" in image) {
      const list = (image as { image_url_list?: unknown }).image_url_list
      if (Array.isArray(list)) {
        const url = list.find((value) => typeof value === "string" && value.startsWith("http"))
        if (typeof url === "string") return url
      }
    }
  }
  return undefined
}

export function ProductCatalog({
  stores,
  activeShopId,
  onShopChange,
  products,
  loading,
  error,
  collectedAt,
}: {
  stores: Store[]
  activeShopId: string | null
  onShopChange: (shopId: string) => void
  products: Product[]
  loading: boolean
  error: string | null
  collectedAt: string | null
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<string>("all")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((product) => {
      const okQuery = q === "" || (product.name ?? "").toLowerCase().includes(q)
      const okStatus = status === "all" || (product.publication ?? "unknown") === status
      return okQuery && okStatus
    })
  }, [products, query, status])

  return (
    <Card radius="lg" padding="lg" withBorder>
      <Group justify="space-between" mb="md" wrap="wrap">
        <div>
          <Text fw={800} fz="md">
            Katalog Produk
          </Text>
          <Text fz={12.5} fw={600} c="dimmed" mt={2}>
            {collectedAt
              ? `Diperbarui ${new Date(collectedAt).toLocaleString("id-ID")}`
              : "Data langsung dari Shopee"}
          </Text>
        </div>
        <Group gap="sm" wrap="nowrap">
          <Select
            data={stores.map((store) => ({ value: store.id, label: storeLabel(store) }))}
            value={activeShopId}
            onChange={(value) => value && onShopChange(value)}
            placeholder="Pilih toko"
            allowDeselect={false}
            w={190}
            disabled={stores.length === 0}
          />
          <Select
            data={[
              { value: "all", label: "Semua status" },
              { value: "active", label: "Aktif" },
              { value: "inactive", label: "Nonaktif" },
              { value: "unknown", label: "Tidak diketahui" },
            ]}
            value={status}
            onChange={(value) => setStatus(value ?? "all")}
            allowDeselect={false}
            w={160}
          />
        </Group>
      </Group>

      <TextInput
        placeholder="Cari nama produk…"
        leftSection={<IconSearch size={16} />}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        mb="md"
        radius="md"
      />

      {error ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md">
          Gagal memuat katalog: <span className="num">{error}</span>
        </Alert>
      ) : loading ? (
        <Text c="dimmed" ta="center" py="xl">
          Memuat katalog dari Shopee…
        </Text>
      ) : stores.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          Belum ada toko terhubung. Hubungkan toko untuk melihat katalog.
        </Text>
      ) : filtered.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          Tidak ada produk untuk filter ini.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Produk</Table.Th>
                <Table.Th ta="right">Terjual</Table.Th>
                <Table.Th ta="right">Dilihat</Table.Th>
                <Table.Th ta="right">Rating</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((product) => {
                const image = firstImage(product)
                const meta = publicationMeta[product.publication ?? "unknown"]
                const rating = product.stats?.rating_star
                return (
                  <Table.Tr key={String(product.productId)}>
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <Image
                          src={image}
                          w={44}
                          h={44}
                          radius="md"
                          fallbackSrc="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"
                          fit="cover"
                        >
                          <IconPhoto size={18} />
                        </Image>
                        <div style={{ minWidth: 0 }}>
                          <Text fz={13.5} fw={700} lineClamp={2}>
                            {product.name ?? "(tanpa nama)"}
                          </Text>
                          <Text className="num" fz={12} c="dimmed">
                            ID {String(product.productId)}
                          </Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right" className="num">
                      {nf.format(product.stats?.sale ?? 0)}
                    </Table.Td>
                    <Table.Td ta="right" className="num">
                      {nf.format(product.stats?.views ?? 0)}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <IconStar size={13} color="#F59E0B" fill="#F59E0B" />
                        <Text className="num" fz={13}>
                          {typeof rating === "number" ? rating.toFixed(1) : "0"}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={meta.color} variant="light" radius="sm">
                        {meta.label}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  )
}
