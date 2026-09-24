import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Image,
  Pagination,
  Select,
  Table,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core"
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronUp,
  IconPhoto,
  IconSearch,
  IconSelector,
  IconStar,
} from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { type Product, type Publication, type Store, storeLabel } from "../api.ts"
import { ProductDetailDrawer } from "./ProductDetailDrawer.tsx"

const nf = new Intl.NumberFormat("id-ID")
const PAGE_SIZE = 50

const publicationMeta: Record<Publication, { label: string; color: string }> = {
  active: { label: "Aktif", color: "green" },
  inactive: { label: "Nonaktif", color: "orange" },
  unknown: { label: "Tidak diketahui", color: "gray" },
}

type SortKey = "name" | "sale" | "views" | "rating"

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

function sortValue(product: Product, key: SortKey): number | string {
  switch (key) {
    case "name":
      return (product.name ?? "").toLowerCase()
    case "sale":
      return product.stats?.sale ?? 0
    case "views":
      return product.stats?.views ?? 0
    case "rating":
      return product.stats?.rating_star ?? 0
  }
}

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string
  column: SortKey
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onSort: (key: SortKey) => void
  align?: "left" | "right"
}) {
  const active = sortKey === column
  const Icon = active ? (sortDir === "asc" ? IconChevronUp : IconChevronDown) : IconSelector
  return (
    <Table.Th>
      <UnstyledButton onClick={() => onSort(column)} w="100%">
        <Group gap={4} justify={align === "right" ? "flex-end" : "flex-start"} wrap="nowrap">
          <Text fz={12} fw={700} c={active ? "cyan.7" : "dimmed"} tt="uppercase">
            {label}
          </Text>
          <Icon size={14} color={active ? "var(--mantine-color-cyan-6)" : "#94A3B8"} />
        </Group>
      </UnstyledButton>
    </Table.Th>
  )
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
  const [sortKey, setSortKey] = useState<SortKey>("sale")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Product | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = products.filter((product) => {
      const okQuery = q === "" || (product.name ?? "").toLowerCase().includes(q)
      const okStatus = status === "all" || (product.publication ?? "unknown") === status
      return okQuery && okStatus
    })
    const factor = sortDir === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * factor
      return ((va as number) - (vb as number)) * factor
    })
  }, [products, query, status, sortKey, sortDir])

  useEffect(() => {
    setPage(1)
  }, [query, status, sortKey, sortDir, activeShopId])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "name" ? "asc" : "desc")
    }
  }

  function openDetail(product: Product) {
    setSelected(product)
    setDrawerOpen(true)
  }

  return (
    <Card radius="lg" padding="lg" withBorder>
      <Group justify="space-between" mb="md" wrap="wrap">
        <div>
          <Text fw={800} fz="lg">
            Produk
          </Text>
          <Text fz={12.5} fw={600} c="dimmed" mt={2}>
            {collectedAt
              ? `${nf.format(sorted.length)} produk · diperbarui ${new Date(collectedAt).toLocaleString("id-ID")}`
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
      ) : sorted.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          Tidak ada produk untuk filter ini.
        </Text>
      ) : (
        <>
          <Table.ScrollContainer minWidth={680}>
            <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <SortHeader label="Produk" column="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortHeader label="Terjual" column="sale" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortHeader label="Dilihat" column="views" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortHeader label="Rating" column="rating" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageItems.map((product) => {
                  const image = firstImage(product)
                  const meta = publicationMeta[product.publication ?? "unknown"]
                  const rating = product.stats?.rating_star
                  return (
                    <Table.Tr
                      key={String(product.productId)}
                      onClick={() => openDetail(product)}
                      style={{ cursor: "pointer" }}
                    >
                      <Table.Td>
                        <Group gap="sm" wrap="nowrap">
                          {image ? (
                            <Image src={image} w={44} h={44} radius="md" fit="cover" />
                          ) : (
                            <Center w={44} h={44} style={{ flexShrink: 0, borderRadius: 8, background: "#F1F5F9" }}>
                              <IconPhoto size={18} color="#94A3B8" />
                            </Center>
                          )}
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

          {pageCount > 1 ? (
            <Group justify="space-between" mt="md" wrap="wrap">
              <Text fz={12.5} c="dimmed">
                Menampilkan {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} dari{" "}
                {nf.format(sorted.length)}
              </Text>
              <Pagination total={pageCount} value={page} onChange={setPage} color="cyan" size="sm" />
            </Group>
          ) : null}
        </>
      )}

      <ProductDetailDrawer
        shopId={activeShopId}
        product={selected}
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </Card>
  )
}
