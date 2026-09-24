import { AppShell, Center, Grid, Loader, Stack } from "@mantine/core"
import { useCallback, useEffect, useState } from "react"
import { api, ApiError, type Connection, type Product, type Store } from "./api.ts"
import { AdsGms } from "./components/AdsGms.tsx"
import { AdsProductCampaigns } from "./components/AdsProductCampaigns.tsx"
import { AdsWorkspace } from "./components/AdsWorkspace.tsx"
import { ConnectionStatus } from "./components/ConnectionStatus.tsx"
import { Login } from "./components/Login.tsx"
import { ProductCatalog } from "./components/ProductCatalog.tsx"
import { ProductStatusDonut } from "./components/ProductStatusDonut.tsx"
import { ShopPerformance } from "./components/ShopPerformance.tsx"
import { type DashboardView, Sidebar } from "./components/Sidebar.tsx"
import { TopBar } from "./components/TopBar.tsx"

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [activeShopId, setActiveShopId] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [collectedAt, setCollectedAt] = useState<string | null>(null)
  const [baseLoading, setBaseLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [view, setView] = useState<DashboardView>("dashboard")
  const [refreshTick, setRefreshTick] = useState(0)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    void api.sessionStatus().then(setAuthed)
  }, [])

  const loadBase = useCallback(async () => {
    setBaseLoading(true)
    try {
      const [storeList, connectionData] = await Promise.all([api.stores(), api.connections()])
      setStores(storeList)
      setConnections(connectionData.connections)
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
    setRefreshTick((current) => current + 1)
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

  return (
    <AppShell
      layout="alt"
      navbar={{ width: 250, breakpoint: "md", collapsed: { mobile: !mobileNavOpen } }}
      header={{ height: 72 }}
      padding="lg"
      styles={{ main: { background: "var(--app-bg)" } }}
    >
      <AppShell.Navbar withBorder>
        <Sidebar
          stores={stores}
          connections={connections}
          activeView={view}
          onNavigate={(nextView) => {
            setView(nextView)
            setMobileNavOpen(false)
          }}
          onConnect={onConnect}
          onLogout={() => void onLogout()}
        />
      </AppShell.Navbar>

      <AppShell.Header withBorder>
        <TopBar
          view={view}
          onRefresh={onRefresh}
          onConnect={onConnect}
          refreshing={baseLoading || catalogLoading}
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
        />
      </AppShell.Header>

      <AppShell.Main>
        {view === "dashboard" ? (
          <Stack gap="lg">
            <ShopPerformance shopId={activeShopId} />

            <Grid gap="lg">
              <Grid.Col span={{ base: 12, lg: 5 }}>
                <ProductStatusDonut products={products} loading={catalogLoading} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 7 }}>
                <ConnectionStatus stores={stores} connections={connections} />
              </Grid.Col>
            </Grid>
          </Stack>
        ) : view === "ads" ? (
          <Stack gap="lg">
            <AdsWorkspace
              stores={stores}
              connections={connections}
              activeShopId={activeShopId}
              onShopChange={setActiveShopId}
              onConnect={onConnect}
              refreshTick={refreshTick}
            />
            <AdsProductCampaigns
              shopId={activeShopId}
              connectionReady={
                connections.find((item) => item.shopId === activeShopId)?.state === "ready"
              }
              refreshTick={refreshTick}
            />
            <AdsGms
              shopId={activeShopId}
              connectionReady={
                connections.find((item) => item.shopId === activeShopId)?.state === "ready"
              }
              refreshTick={refreshTick}
            />
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
