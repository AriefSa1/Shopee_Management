import { Alert, Button, Card, Center, PasswordInput, Stack, Text, ThemeIcon } from "@mantine/core"
import { IconAlertCircle, IconLayoutGrid } from "@tabler/icons-react"
import { type FormEvent, useState } from "react"
import { api, ApiError } from "../api.ts"

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.login(token.trim())
      onSuccess()
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : "error"
      setError(
        code === "authentication_failed"
          ? "Token login salah."
          : `Gagal masuk (${code}).`,
      )
      setSubmitting(false)
    }
  }

  return (
    <Center mih="100dvh" p="md" style={{ background: "var(--app-bg)" }}>
      <Card radius="lg" padding="xl" withBorder w={400} maw="100%">
        <Stack align="center" gap={4} mb="lg">
          <ThemeIcon size={46} radius="md" color="cyan">
            <IconLayoutGrid size={26} />
          </ThemeIcon>
          <Text fw={800} fz="xl" mt="sm">
            OmniHub
          </Text>
          <Text fz="sm" c="dimmed" ta="center">
            Masuk dengan token operator internal untuk melihat data toko.
          </Text>
        </Stack>

        <form onSubmit={submit}>
          <Stack gap="md">
            {error ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md" p="sm">
                {error}
              </Alert>
            ) : null}
            <PasswordInput
              label="Token login internal"
              description="Nilai INTERNAL_LOGIN_TOKEN, bukan Partner Key Shopee."
              placeholder="••••••••"
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
              autoComplete="off"
              required
              size="md"
            />
            <Button type="submit" size="md" color="cyan" loading={submitting} fullWidth>
              Masuk
            </Button>
          </Stack>
        </form>
      </Card>
    </Center>
  )
}
