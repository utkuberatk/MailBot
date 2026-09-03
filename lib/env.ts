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

/**
 * Gecici tunel / yerel adresler — mail iceriginde kullanilamaz.
 * Bu alan adlarina giden linkler mailin spam'e dusmesine yol acar.
 */
const UNTRUSTED_MAIL_HOSTS = [
  'trycloudflare.com',
  'ngrok-free.app',
  'ngrok-free.dev',
  'ngrok.io',
  'ngrok.app',
  'loca.lt',
  'serveo.net',
  'localhost.run',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]

/** Mail icine konabilecek bir adres mi? (https + kalici alan adi) */
export function isTrustedMailUrl(value: string): boolean {
  let host: string
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    host = url.hostname.toLowerCase()
  } catch {
    return false
  }

  return !UNTRUSTED_MAIL_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`))
}

/** Yerel gelistirme adresi mi? (Sadece TRACKING_DEV_LOCAL ile kabul edilir.) */
export function isLocalDevUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1'
  } catch {
    return false
  }
}

/**
 * `localhost` yerine `127.0.0.1` kullanir.
 *
 * n8n (Node) `localhost`'u once IPv6 `::1` olarak cozer; Docker'in yayinladigi
 * port veya `next dev` yalnizca IPv4 dinliyorsa istek `ECONNREFUSED ::1:PORT`
 * ile duser. Bu adresler n8n'e govdeyle gectigi icin burada sabitlenir.
 * `host.docker.internal` gibi diger adlar oldugu gibi birakilir.
 */
export function preferIPv4(url: string): string {
  return url.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1')
}

export const env = {
  appUrl: () => optionalEnv('APP_URL', 'http://localhost:3000'),

  /**
   * Maillerin icinden cagrilan adres (takip pikseli, video onizleme, cikis linki).
   *
   * Sadece SAHIP OLDUGUNUZ bir alan adi verilmelidir. Gecici tunel adresleri
   * (trycloudflare, ngrok...) oltalama icin yogun sekilde kotuye kullanildigindan
   * spam filtreleri bu alan adlarina giden linkleri iceren mailleri dogrudan
   * spam'e atar — bu yuzden asagidaki liste reddedilir.
   *
   * Bos veya gecersizse takip kapanir: mailde piksel ve gorsel olmaz,
   * listeden cikis mailto: ile yapilir. Sistem calismaya devam eder.
   */
  mailTrackingUrl: () => {
    const value = optionalEnv('MAIL_TRACKING_URL').trim().replace(/\/$/, '')
    if (!value) return ''
    if (isTrustedMailUrl(value)) return value
    if (env.trackingDevLocal() && isLocalDevUrl(value)) return value
    return ''
  },
  trackingEnabled: () => env.mailTrackingUrl() !== '',

  /**
   * Gelistirme kapisi.
   *
   * TRACKING_DEV_LOCAL="1" iken (ve yalnizca production disinda) takip adresi
   * olarak http://127.0.0.1:3000 kabul edilir. Boylece alan adi alinmadan once
   * piksel -> olay -> cift tik -> Discord zinciri uctan uca test edilebilir.
   * Bu maillerdeki takip linkleri ALICIDA CALISMAZ; UI kirmizi uyari gosterir.
   */
  trackingDevLocal: () =>
    process.env.NODE_ENV !== 'production' && optionalEnv('TRACKING_DEV_LOCAL') === '1',

  /** Takip acik ama yerel bir adresle mi calisiyor? (UI uyarisi icin.) */
  trackingDevMode: () => env.trackingEnabled() && isLocalDevUrl(env.mailTrackingUrl()),

  internalApiKey: () => requireEnv('APP_INTERNAL_API_KEY'),

  groqApiKey: () => requireEnv('GROQ_API_KEY'),
  groqModel: () => optionalEnv('GROQ_MODEL', 'openai/gpt-oss-120b'),

  gmailClientId: () => requireEnv('GMAIL_CLIENT_ID'),
  gmailClientSecret: () => requireEnv('GMAIL_CLIENT_SECRET'),
  gmailRefreshToken: () => requireEnv('GMAIL_REFRESH_TOKEN'),
  gmailUser: () => requireEnv('GMAIL_USER'),

  /** Mail imzasinda ve List-Unsubscribe basliginda kullanilir. */
  sender: () => ({
    name: optionalEnv('SENDER_NAME'),
    title: optionalEnv('SENDER_TITLE'),
    address: optionalEnv('SENDER_ADDRESS', optionalEnv('GMAIL_USER')),
  }),

  videoBaseUrl: () => optionalEnv('VIDEO_BASE_URL', optionalEnv('APP_URL', 'http://localhost:3000') + '/media'),

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
