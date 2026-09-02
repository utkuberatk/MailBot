import { optionalEnv } from '@/lib/env'

/**
 * Ic servislerin (n8n, Discord bot) erisim kontrolu.
 *
 * Iki yol kabul edilir:
 *  1. Dogru `X-Internal-Key` basligi, veya
 *  2. Tarayici disindan gelen yerel istek (Origin/Sec-Fetch-Site basligi yok).
 *
 * Ikinci kural, n8n ve botun ekstra kimlik bilgisi kurmadan calismasini saglar.
 * Tarayicilar baska bir siteden yapilan isteklerde Origin basligini her zaman
 * gonderdigi icin, kotu niyetli bir web sayfasi bu uclara ulasamaz.
 */
export function isInternalRequest(request: Request): boolean {
  const key = optionalEnv('APP_INTERNAL_API_KEY')
  const provided = request.headers.get('x-internal-key')
  if (key && provided && provided === key) return true

  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')

  // Tarayicidan gelen capraz kaynakli istek: reddet.
  if (origin || (fetchSite && fetchSite !== 'same-origin')) return false

  return true
}

export function unauthorized() {
  return Response.json(
    { error: 'Yetkisiz istek. X-Internal-Key basligini gonderin.' },
    { status: 401 },
  )
}
