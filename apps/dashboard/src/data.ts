// Placeholder data for the dashboard shell. These stand in until the analytics
// endpoints exist; every figure here is illustrative, not real.

export type ChannelKey = "shopee" | "tokopedia" | "lazada" | "tiktok"

export const channelMeta: Record<ChannelKey, { label: string; color: string }> = {
  shopee: { label: "Shopee", color: "#EE4D2D" },
  tokopedia: { label: "Tokopedia", color: "#42B549" },
  lazada: { label: "Lazada", color: "#8B5CF6" },
  tiktok: { label: "TikTok Shop", color: "#0F172A" },
}

export type Kpi = {
  key: string
  label: string
  value: string
  unit?: string
  delta: number
  icon: "sales" | "orders" | "units" | "avg"
  tint: string
}

export const kpis: Kpi[] = [
  { key: "sales", label: "Total Penjualan", value: "Rp 248,6", unit: "jt", delta: 12.4, icon: "sales", tint: "#ECFEFF" },
  { key: "orders", label: "Pesanan", value: "1.842", delta: 8.1, icon: "orders", tint: "#EEF6FF" },
  { key: "units", label: "Produk Terjual", value: "4.517", delta: -3.2, icon: "units", tint: "#F3F0FF" },
  { key: "avg", label: "Rata-rata / Order", value: "Rp 135", unit: "rb", delta: 4.7, icon: "avg", tint: "#FFF4EC" },
]

export type SalesPoint = { day: string; "Minggu ini": number; "Minggu lalu": number }

export const salesTrend: SalesPoint[] = [
  { day: "Sen", "Minggu ini": 42, "Minggu lalu": 38 },
  { day: "Sel", "Minggu ini": 55, "Minggu lalu": 44 },
  { day: "Rab", "Minggu ini": 48, "Minggu lalu": 50 },
  { day: "Kam", "Minggu ini": 63, "Minggu lalu": 52 },
  { day: "Jum", "Minggu ini": 58, "Minggu lalu": 49 },
  { day: "Sab", "Minggu ini": 78, "Minggu lalu": 60 },
  { day: "Min", "Minggu ini": 72, "Minggu lalu": 64 },
]

export type ChannelSlice = { name: string; value: number; color: string; share: number }

export const channelSales: ChannelSlice[] = [
  { name: "Shopee", value: 114, color: "#EE4D2D", share: 46 },
  { name: "Tokopedia", value: 67, color: "#42B549", share: 27 },
  { name: "Lazada", value: 37, color: "#8B5CF6", share: 15 },
  { name: "TikTok Shop", value: 30, color: "#0F172A", share: 12 },
]

export type OrderStatus = "to_ship" | "paid" | "done" | "unpaid"

export const orderStatusMeta: Record<OrderStatus, { label: string; color: string }> = {
  to_ship: { label: "Perlu dikirim", color: "orange" },
  paid: { label: "Dibayar", color: "cyan" },
  done: { label: "Selesai", color: "green" },
  unpaid: { label: "Belum bayar", color: "gray" },
}

export type Order = {
  id: string
  customer: string
  items: number
  channel: ChannelKey
  total: string
  status: OrderStatus
}

export const recentOrders: Order[] = [
  { id: "#SPX-77120", customer: "Dewi Anggraini", items: 3, channel: "shopee", total: "Rp 312.000", status: "to_ship" },
  { id: "#TKP-4482", customer: "Budi Hartono", items: 1, channel: "tokopedia", total: "Rp 89.000", status: "paid" },
  { id: "#TTS-9051", customer: "Siti Rahma", items: 5, channel: "tiktok", total: "Rp 540.000", status: "done" },
  { id: "#SPX-77098", customer: "Andi Pratama", items: 2, channel: "shopee", total: "Rp 156.000", status: "unpaid" },
  { id: "#LZD-2210", customer: "Rina Kusuma", items: 4, channel: "lazada", total: "Rp 268.000", status: "to_ship" },
]

export type Task = { label: string; count: number; color: string; bg: string; icon: "truck" | "clock" | "chat" }

export const tasks: Task[] = [
  { label: "Harus dikirim hari ini", count: 28, color: "#EA580C", bg: "#FFF7ED", icon: "truck" },
  { label: "Menunggu pembayaran", count: 13, color: "#CA8A04", bg: "#FEFCE8", icon: "clock" },
  { label: "Chat belum dibalas", count: 7, color: "#2563EB", bg: "#EFF6FF", icon: "chat" },
]

export type StockItem = { name: string; sku: string; left: number; critical: boolean }

export const lowStock: StockItem[] = [
  { name: "Kaos Polos Premium — Hitam", sku: "KP-BLK-L", left: 4, critical: true },
  { name: "Tumbler Vakum 500ml", sku: "TMB-500", left: 2, critical: true },
  { name: "Totebag Kanvas Motif", sku: "TB-CNV-02", left: 7, critical: false },
]
