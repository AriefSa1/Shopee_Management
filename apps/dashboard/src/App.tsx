import { AppShell, Center, Grid, Loader, Stack } from "@mantine/core"
import { useCallback, useEffect, useState } from "react"
import {
  api,
  ApiError,
  type Connection,
  type ConnectionsSummary,
  type Product,
  type Store,
} from "./api.ts"
import { ConnectionStatus } from "./components/ConnectionStatus.tsx"
import { Login } from "./components/Login.tsx"
import { ProductCatalog } from "./components/ProductCatalog.tsx"
import { ProductStatusDonut } from "./components/ProductStatusDonut.tsx"
import { type DashboardView, Sidebar } from "./components/Sidebar.tsx"
import { StatCards } from "./components/StatCards.tsx"
import { TopBar } from "./components/TopBar.tsx"

const emptySummary: ConnectionsSummary = {
  total: 0,
  ready: 0,
  awaitingExchange: 0,
  expired: 0,
  reauthRequired: 0,
}

function sumStat(products: Product[], key: "sale" | "views"): number {
  return products.reduce((total, product) => {
    const value = product.stats?.[key]
    return total + (typeof value === "number" ? value : 0)
  }, 0)
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [summary, setSummary] = useState<ConnectionsSummary>(emptySummary)
  const [activeShopId, setActiveShopId] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [collectedAt, setCollectedAt] = useState<string | null>(null)
  const [baseLoading, setBaseLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [view, setView] = useState<DashboardView>("dashboard")

  useEffect(() => {
    void api.sessionStatus().then(setAuthed)
  }, [])

  const loadBase = useCallback(async () => {
    setBaseLoading(true)
    try {
      const [storeList, connectionData] = await Promise.all([api.stores(), api.connections()])
      setStores(storeList)
      setConnections(connectionData.connections)
      setSummary(connectionData.summary)
      setActiveShopId((current) => current ?? storeList[0]?.id ?? null)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setAuthed(false)
    } finally {
      setBaseLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed === true) void loadBase()
  }, [authed, loadBase])

  const loadCatalog = useCallback(async (shopId: string) => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const catalog = await api.catalog(shopId)
      setProducts(catalog.products)
      setCollectedAt(catalog.collectedAt)
    } catch (cause) {
      setProducts([])
      if (cause instanceof ApiError && cause.status === 401) {
        setAuthed(false)
        return
      }
      setCatalogError(cause instanceof ApiError ? cause.code : "error")
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed === true && activeShopId !== null) void loadCatalog(activeShopId)
  }, [authed, activeShopId, loadCatalog])

  const onConnect = useCallback(() => {
    window.location.href = "/connect/shopee"
  }, [])

  const onLogout = useCallback(async () => {
    await api.logout()
    setAuthed(false)
    setStores([])
    setConnections([])
    setProducts([])
    setActiveShopId(null)
  }, [])

  const onRefresh = useCallback(() => {
    void loadBase()
    if (activeShopId !== null) void loadCatalog(activeShopId)
  }, [loadBase, loadCatalog, activeShopId])

  if (authed === null) {
    return (
      <Center mih="100dvh" style={{ background: "var(--app-bg)" }}>
        <Loader color="cyan" />
      </Center>
    )
  }

  if (authed === false) {
    return <Login onSuccess={() => setAuthed(true)} />
  }

  const kpiValues = {
    storeCount: stores.length,
    readyCount: summary.ready,
    productCount: products.length,
    totalSold: sumStat(products, "sale"),
    totalViews: sumStat(products, "views"),
  }

  return (
    <AppShell
      layout="alt"
      navbar={{ width: 250, breakpoint: "md" }}
      header={{ height: 72 }}
      padding="lg"
      styles={{ main: { background: "var(--app-bg)" } }}
    >
      <AppShell.Navbar withBorder>
        <Sidebar
          stores={stores}
          connections={connections}
          activeView={view}
          onNavigate={setView}
          onConnect={onConnect}
          onLogout={() => void onLogout()}
        />
      </AppShell.Navbar>

      <AppShell.Header withBorder>
        <TopBar onRefresh={onRefresh} onConnect={onConnect} refreshing={baseLoading || catalogLoading} />
      </AppShell.Header>

      <AppShell.Main>
        {view === "dashboard" ? (
          <Stack gap="lg">
            <StatCards values={kpiValues} loading={baseLoading || catalogLoading} />

            <Grid gap="lg">
              <Grid.Col span={{ base: 12, lg: 5 }}>
                <ProductStatusDonut products={products} loading={catalogLoading} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 7 }}>
                <ConnectionStatus stores={stores} connections={connections} />
              </Grid.Col>
            </Grid>
          </Stack>
        ) : (
          <ProductCatalog
            stores={stores}
            activeShopId={activeShopId}
            onShopChange={setActiveShopId}
            products={products}
            loading={catalogLoading}
            error={catalogError}
            collectedAt={collectedAt}
          />
        )}
      </AppShell.Main>
    </AppShell>
  )
}
