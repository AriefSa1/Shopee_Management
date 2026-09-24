import {
  Alert,
  Badge,
  Box,
  Center,
  Divider,
  Drawer,
  Grid,
  Group,
  Image,
  Loader,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core"
import { IconAlertCircle, IconPhoto, IconStar } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { api, ApiError, type Product, type Publication } from "../api.ts"
import { parseProductDetail, type ProductDetail, rupiah, unixToDate } from "../detail.ts"

const nf = new Intl.NumberFormat("id-ID")

const publicationMeta: Record<Publication, { label: string; color: string }> = {
  active: { label: "Aktif", color: "green" },
  inactive: { label: "Nonaktif", color: "orange" },
  unknown: { label: "Tidak diketahui", color: "gray" },
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Box p="sm" style={{ borderRadius: 10, background: "#F8FAFC", border: "1px solid #EEF2F6" }}>
      <Text fz={11} fw={700} c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text className="num" fz={18} fw={700} mt={2}>
        {value}
      </Text>
    </Box>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap="md">
      <Text fz={13} c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text fz={13} fw={600} ta="right" style={{ wordBreak: "break-word" }}>
        {value}
      </Text>
    </Group>
  )
}

function Gallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0)
  useEffect(() => {
    setActive(0)
  }, [])
  if (images.length === 0) {
    return (
      <Center h={280} style={{ borderRadius: 12, background: "#F1F5F9" }}>
        <IconPhoto size={40} color="#94A3B8" />
      </Center>
    )
  }
  return (
    <div>
      <Image src={images[active]} h={280} radius="md" fit="contain" bg="#F8FAFC" alt={name} />
      {images.length > 1 ? (
        <Group gap="xs" mt="xs" wrap="wrap">
          {images.map((url, index) => (
            <Box
              key={url}
              component="button"
              type="button"
              onClick={() => setActive(index)}
              w={52}
              h={52}
              p={0}
              style={{
                borderRadius: 8,
                overflow: "hidden",
                cursor: "pointer",
                border: index === active ? "2px solid var(--mantine-color-cyan-6)" : "1px solid #E2E8F0",
                background: "none",
              }}
            >
              <Image src={url} w="100%" h="100%" fit="cover" alt={`${name} ${index + 1}`} />
            </Box>
          ))}
        </Group>
      ) : null}
    </div>
  )
}

export function ProductDetailDrawer({
  shopId,
  product,
  opened,
  onClose,
}: {
  shopId: string | null
  product: Product | null
  opened: boolean
  onClose: () => void
}) {
  const [detail, setDetail] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened || product === null || shopId === null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    api
      .productDetail(shopId, product.productId)
      .then((raw) => {
        if (!cancelled) setDetail(parseProductDetail(raw))
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.code : "error")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [opened, product, shopId])

  const publication = product?.publication ?? "unknown"
  const meta = publicationMeta[publication]

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="xl"
      padding="lg"
      title={
        <Group gap="sm">
          <Text fw={800} fz="md" lineClamp={1}>
            {detail?.name ?? product?.name ?? "Detail Produk"}
          </Text>
          <Badge color={meta.color} variant="light" radius="sm">
            {meta.label}
          </Badge>
        </Group>
      }
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {loading ? (
        <Center py={80}>
          <Loader color="cyan" />
        </Center>
      ) : error ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md">
          Gagal memuat detail: <span className="num">{error}</span>
        </Alert>
      ) : detail === null ? null : (
        <Stack gap="lg">
          <Gallery images={detail.images} name={detail.name ?? ""} />

          <Group gap="sm" align="baseline" wrap="wrap">
            <Text className="num" fz={26} fw={800} c="cyan.7">
              {detail.priceMin === detail.priceMax
                ? rupiah(detail.priceMin)
                : `${rupiah(detail.priceMin)} – ${rupiah(detail.priceMax)}`}
            </Text>
            {detail.originalMax !== undefined &&
            detail.priceMax !== undefined &&
            detail.originalMax > detail.priceMax ? (
              <Text className="num" td="line-through" c="dimmed">
                {rupiah(detail.originalMax)}
              </Text>
            ) : null}
          </Group>

          <SimpleGrid cols={4} spacing="sm">
            <StatTile label="Terjual" value={nf.format(detail.stats.sale ?? 0)} />
            <StatTile label="Dilihat" value={nf.format(detail.stats.views ?? 0)} />
            <StatTile label="Disukai" value={nf.format(detail.stats.likes ?? 0)} />
            <StatTile
              label="Rating"
              value={`${typeof detail.stats.rating === "number" ? detail.stats.rating.toFixed(1) : "0"}★`}
            />
          </SimpleGrid>

          <div>
            <Title order={5} mb="sm">
              Informasi Produk
            </Title>
            <Grid gap="xs">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Stack gap={8}>
                  <InfoRow label="ID Produk" value={detail.itemId ?? "—"} />
                  <InfoRow label="SKU" value={detail.sku ?? "—"} />
                  <InfoRow label="Kategori" value={detail.categoryId ?? "—"} />
                  <InfoRow label="Brand" value={detail.brand ?? "—"} />
                  <InfoRow label="Kondisi" value={detail.condition ?? "—"} />
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Stack gap={8}>
                  <InfoRow
                    label="Berat"
                    value={detail.weightKg !== undefined ? `${detail.weightKg} kg` : "—"}
                  />
                  <InfoRow label="Dimensi" value={detail.dimension ?? "—"} />
                  <InfoRow label="Pre-order" value={detail.preOrder ?? "—"} />
                  <InfoRow label="Ditambahkan" value={unixToDate(detail.createTime)} />
                  <InfoRow label="Diperbarui" value={unixToDate(detail.updateTime)} />
                </Stack>
              </Grid.Col>
            </Grid>
            {detail.logistics.length > 0 ? (
              <Group gap="xs" mt="sm">
                <Text fz={13} c="dimmed">
                  Kurir aktif:
                </Text>
                {detail.logistics.map((logistic) => (
                  <Badge key={logistic} variant="light" color="gray" radius="sm">
                    {logistic}
                  </Badge>
                ))}
              </Group>
            ) : null}
          </div>

          <div>
            <Divider mb="sm" />
            <Title order={5} mb="sm">
              Varian &amp; Harga <Text span c="dimmed" fz="sm">({detail.models.length} model)</Text>
            </Title>
            {detail.models.length === 0 ? (
              <Text c="dimmed" fz="sm">
                Produk ini tidak memiliki variasi (single model).
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={480}>
                <Table verticalSpacing="xs" horizontalSpacing="sm" fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Varian</Table.Th>
                      <Table.Th>SKU</Table.Th>
                      <Table.Th ta="right">Harga</Table.Th>
                      <Table.Th ta="right">Coret</Table.Th>
                      <Table.Th ta="right">Stok</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {detail.models.map((model) => (
                      <Table.Tr key={model.id}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            {model.name}
                            {model.hasPromotion ? (
                              <Badge size="xs" color="pink" variant="light">
                                Promo
                              </Badge>
                            ) : null}
                          </Group>
                        </Table.Td>
                        <Table.Td className="num" c="dimmed">
                          {model.sku ?? "—"}
                        </Table.Td>
                        <Table.Td ta="right" className="num" fw={700}>
                          {rupiah(model.currentPrice)}
                        </Table.Td>
                        <Table.Td ta="right" className="num" c="dimmed">
                          {model.originalPrice ? rupiah(model.originalPrice) : "—"}
                        </Table.Td>
                        <Table.Td ta="right" className="num">
                          {model.stock !== undefined ? nf.format(model.stock) : "—"}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </div>

          {detail.description ? (
            <div>
              <Divider mb="sm" />
              <Title order={5} mb="sm">
                Deskripsi
              </Title>
              <ScrollArea.Autosize mah={220}>
                <Text fz={13} c="#334155" style={{ whiteSpace: "pre-wrap" }}>
                  {detail.description}
                </Text>
              </ScrollArea.Autosize>
            </div>
          ) : null}

          {detail.attributes.length > 0 ? (
            <div>
              <Divider mb="sm" />
              <Title order={5} mb="sm">
                Atribut
              </Title>
              <Stack gap={8}>
                {detail.attributes.map((attribute) => (
                  <InfoRow key={attribute.name} label={attribute.name} value={attribute.value} />
                ))}
              </Stack>
            </div>
          ) : null}

          {detail.promotions.length > 0 ? (
            <div>
              <Divider mb="sm" />
              <Title order={5} mb="sm">
                Promosi <Text span c="dimmed" fz="sm">({detail.promotions.length})</Text>
              </Title>
              <Stack gap={8}>
                {detail.promotions.map((promotion, index) => (
                  <Group key={`${promotion.id}-${index}`} justify="space-between" wrap="nowrap">
                    <div>
                      <Text fz={13} fw={600}>
                        {promotion.type ?? "Promo"}
                      </Text>
                      <Text className="num" fz={12} c="dimmed">
                        {unixToDate(promotion.start)} – {unixToDate(promotion.end)}
                      </Text>
                    </div>
                    <Badge variant="light" color="pink" radius="sm">
                      {promotion.status ?? "—"}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            </div>
          ) : null}

          <Group gap="xs">
            <IconStar size={13} color="#F59E0B" fill="#F59E0B" />
            <Text fz={12} c="dimmed">
              {nf.format(detail.stats.comments ?? 0)} ulasan
            </Text>
          </Group>
        </Stack>
      )}
    </Drawer>
  )
}
