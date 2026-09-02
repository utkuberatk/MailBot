/**
 * Ortam degiskenlerine tek noktadan erisim.
 *
 * Kural: hicbir yerde process.env dogrudan okunmaz; buradaki yardimcilar
 * kullanilir. Boylece eksik bir anahtar, kullaniciya ne yapmasi gerektigini
 * soyleyen anlasilir bir hata verir.
 */

export class MissingEnvError extends Error {
  constructor(key: string) {
    super(
      `Ortam degiskeni eksik: ${key}. .env dosyaniza ekleyip uygulamayi yeniden baslatin.`,
    )
    this.name = 'MissingEnvError'
  }
}

/** Zorunlu degisken — yoksa hata firlatir. */
export function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value || value.trim() === '') throw new MissingEnvError(key)
  return value
}

/** Opsiyonel degisken — yoksa varsayilan doner. */
export function optionalEnv(key: string, fallback = ''): string {
  const value = process.env[key]
  return value && value.trim() !== '' ? value : fallback
}

/** Sayisal degisken — gecersizse varsayilan doner. */
export function numberEnv(key: string, fallback: number): number {
  const parsed = Number(process.env[key])
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Bir grup degiskenden hangilerinin eksik oldugunu doner (Ayarlar sayfasi icin). */
export function missingKeys(keys: string[]): string[] {
  return keys.filter((key) => !process.env[key] || process.env[key]!.trim() === '')
}

export const env = {
  appUrl: () => optionalEnv('APP_URL', 'http://localhost:3000'),
  internalApiKey: () => requireEnv('APP_INTERNAL_API_KEY'),

  groqApiKey: () => requireEnv('GROQ_API_KEY'),
  groqModel: () => optionalEnv('GROQ_MODEL', 'llama-3.3-70b-versatile'),

  gmailClientId: () => requireEnv('GMAIL_CLIENT_ID'),
  gmailClientSecret: () => requireEnv('GMAIL_CLIENT_SECRET'),
  gmailRefreshToken: () => requireEnv('GMAIL_REFRESH_TOKEN'),
  gmailUser: () => requireEnv('GMAIL_USER'),

  n8nBaseUrl: () => optionalEnv('N8N_BASE_URL', 'http://localhost:5678'),
  n8nApiKey: () => requireEnv('N8N_API_KEY'),
  n8nDiscoverWebhook: () =>
    optionalEnv('N8N_WEBHOOK_DISCOVER_URL', 'http://localhost:5678/webhook/mailbot-discovery'),

  searxngUrl: () => optionalEnv('SEARXNG_URL', 'http://localhost:8080'),

  sendLimits: () => ({
    daily: numberEnv('SEND_DAILY_LIMIT', 50),
    hourly: numberEnv('SEND_HOURLY_LIMIT', 20),
    minDelaySeconds: numberEnv('SEND_MIN_DELAY_SECONDS', 45),
    maxDelaySeconds: numberEnv('SEND_MAX_DELAY_SECONDS', 90),
  }),
}
