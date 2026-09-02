import { optionalEnv } from '@/lib/env'

/** Istek gercekten bu makineden mi geliyor? (Tunel uzerinden gelenler degil.) */
function isLocalHost(request: Request): boolean {
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

/**
 * Ic servislerin (n8n, Discord bot) erisim kontrolu.
 *
 * Kabul edilenler:
 *  1. Dogru `X-Internal-Key` basligi, veya
 *  2. localhost'a yapilan, tarayici disindan gelen istek
 *     (Origin/Sec-Fetch-Site basligi yok).
 *
 * Ikinci kural n8n ve botun ekstra kimlik bilgisi kurmadan calismasini saglar.
 * Tarayicilar baska bir siteden yapilan isteklerde Origin basligini her zaman
 * gonderdigi icin kotu niyetli bir web sayfasi bu uclara ulasamaz.
 *
 * PUBLIC_URL ile uygulama disariya acildiginda (cloudflared), tunel uzerinden
 * gelen isteklerin Host basligi localhost olmadigi icin anahtar ZORUNLU olur.
 * Takip pikseli, cikis linki ve /media bu kontrolu kullanmaz; disaridan
 * erisilebilir kalirlar.
 */
export function isInternalRequest(request: Request): boolean {
  const key = optionalEnv('APP_INTERNAL_API_KEY')
  const provided = request.headers.get('x-internal-key')
  if (key && provided && provided === key) return true

  if (!isLocalHost(request)) return false

  const fetchSite = request.headers.get('sec-fetch-site')
  const origin = request.headers.get('origin')

  // Tarayici istegi: yalnizca ayni kaynaktan geliyorsa kabul et.
  // ('none' = adres cubuguna yazilan dogrudan gezinme.)
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none'

  if (origin) {
    try {
      return new URL(origin).host === request.headers.get('host')
    } catch {
      return false
    }
  }

  // Tarayici disindan gelen yerel istek (n8n, Discord botu, curl).
  return true
}

export function unauthorized() {
  return Response.json(
    { error: 'Yetkisiz istek. X-Internal-Key basligini gonderin.' },
    { status: 401 },
  )
}
