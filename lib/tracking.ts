/**
 * Acilma ve tiklama takibi.
 *
 * Mailtrack ve benzeri eklentilerin yaptigi isin bizdeki karsiligi: maile
 * gomulen 1x1 piksel cekildiginde bir OPEN, takipli bir linke tiklandiginda
 * bir CLICK olayi yazilir. Ham olaylar `TrackEvent` tablosunda durur;
 * `Message.openedAt` / `openCount` / `clickCount` bunlarin ozetidir.
 *
 * Iki sey burada toplanmistir:
 *  1. Sahte acilma filtresi — mail tarayicilarinin ve on izleme botlarinin
 *     urettigi "okundu" bilgisini eler.
 *  2. Tiklama linklerinin HMAC imzasi — imzasiz bir yonlendirici, kendi alan
 *     adimizi acik yonlendirme (open redirect) haline getirir; oltacilarin
 *     tam olarak aradigi sey budur ve alan adi itibarini yakar.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { env, optionalEnv } from '@/lib/env'

/** Gonderimden hemen sonraki istekler alicidan degil, tarayicidan gelir. */
const PREFETCH_WINDOW_MS = 10_000

/** Ayni mesaj icin bu sure icindeki tekrarlar tek acilma sayilir. */
const DEDUPE_WINDOW_MS = 30_000

/**
 * Mail tarayici / onizleme botlari.
 *
 * DIKKAT: `GoogleImageProxy` bu listede DEGILDIR ve olmamalidir — Gmail
 * gorselleri kendi proxy'sinden ceker, yani gercek acilmanin ta kendisidir.
 * Onu elemek takibi tamamen oldurur.
 */
const SCANNER_PATTERNS = [
  /barracuda/i,
  /proofpoint/i,
  /mimecast/i,
  /messagelabs/i,
  /symantec/i,
  /forcepoint/i,
  /bingpreview/i,
  /facebookexternalhit/i,
  /slackbot/i,
  /twitterbot/i,
  /skypeuripreview/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /\bcurl\//i,
  /\bwget\b/i,
  /python-requests/i,
  /go-http-client/i,
  /headlesschrome/i,
  /phantomjs/i,
  /microsoft office existence discovery/i,
  /^$/,
]

export type OpenVerdict = { isBot: boolean; reason: string | null }

/** Bu istek gercek bir insan acilmasi mi? */
export function classifyOpen(input: {
  sentAt: Date | null
  at: Date
  userAgent: string | null
  lastRealEventAt: Date | null
}): OpenVerdict {
  const agent = (input.userAgent ?? '').trim()

  if (SCANNER_PATTERNS.some((pattern) => pattern.test(agent))) {
    return { isBot: true, reason: `tarayici/bot user-agent: ${agent.slice(0, 80) || '(bos)'}` }
  }

  if (input.sentAt && input.at.getTime() - input.sentAt.getTime() < PREFETCH_WINDOW_MS) {
    return { isBot: true, reason: 'gonderimden hemen sonra — on yukleme' }
  }

  if (
    input.lastRealEventAt &&
    input.at.getTime() - input.lastRealEventAt.getTime() < DEDUPE_WINDOW_MS
  ) {
    return { isBot: true, reason: 'ayni acilmanin tekrari (30 sn)' }
  }

  return { isBot: false, reason: null }
}

/** Tiklama linkinin imzasi. Anahtar yoksa link hic sarilmaz (bkz. trackedLink). */
export function signTarget(trackingId: string, target: string): string {
  const key = optionalEnv('APP_INTERNAL_API_KEY')
  return createHmac('sha256', key).update(`${trackingId}\n${target}`).digest('hex').slice(0, 24)
}

export function verifyTarget(trackingId: string, target: string, signature: string): boolean {
  if (!optionalEnv('APP_INTERNAL_API_KEY')) return false
  const expected = Buffer.from(signTarget(trackingId, target))
  const provided = Buffer.from(signature ?? '')
  if (expected.length !== provided.length) return false
  return timingSafeEqual(expected, provided)
}

/** Yonlendirilebilir bir adres mi? (javascript:, data: vb. reddedilir) */
export function isSafeRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Maile konacak link. Takip kapaliyken adres oldugu gibi doner — yani
 * alan adimiz yokken mailde YouTube linki YouTube linki olarak kalir.
 */
export function trackedLink(trackingId: string, target: string): string {
  const base = env.mailTrackingUrl()
  if (!base || !target || !optionalEnv('APP_INTERNAL_API_KEY')) return target
  if (!isSafeRedirect(target)) return target

  const signature = signTarget(trackingId, target)
  return `${base}/api/click/${trackingId}?u=${encodeURIComponent(target)}&s=${signature}`
}

/** Istekten user-agent ve IP cikarir (tunel arkasindayken x-forwarded-for). */
export function requestFingerprint(request: Request): { userAgent: string; ip: string } {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  return {
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300),
    ip: (forwarded.split(',')[0] || request.headers.get('x-real-ip') || '').trim().slice(0, 60),
  }
}

/**
 * Bir acilma/tiklama olayini kaydeder.
 *
 * ASLA hata firlatmaz: bu fonksiyon mailin icinden cagrilan uclarda calisir,
 * bir DB hatasi yuzunden piksel bozulmamali.
 */
export async function recordEvent(input: {
  trackingId: string
  type: 'OPEN' | 'CLICK'
  target?: string | null
  request: Request
}): Promise<void> {
  try {
    const message = await db.message.findUnique({
      where: { trackingId: input.trackingId },
      select: { id: true, sentAt: true, openedAt: true },
    })
    if (!message) return

    const at = new Date()
    const { userAgent, ip } = requestFingerprint(input.request)

    const lastReal = await db.trackEvent.findFirst({
      where: { messageId: message.id, type: input.type, isBot: false },
      orderBy: { at: 'desc' },
      select: { at: true },
    })

    const verdict = classifyOpen({
      sentAt: message.sentAt,
      at,
      userAgent,
      lastRealEventAt: lastReal?.at ?? null,
    })

    await db.trackEvent.create({
      data: {
        messageId: message.id,
        type: input.type,
        target: input.target ? input.target.slice(0, 500) : null,
        at,
        userAgent: userAgent || null,
        ip: ip || null,
        isBot: verdict.isBot,
        reason: verdict.reason,
      },
    })

    if (verdict.isBot) return

    // Bir tiklama, acilmanin da kesin kanitidir (gorseller engellenmis olabilir).
    await db.message.update({
      where: { id: message.id },
      data:
        input.type === 'CLICK'
          ? {
              clickCount: { increment: 1 },
              openedAt: message.openedAt ?? at,
              lastOpenedAt: at,
            }
          : {
              openCount: { increment: 1 },
              openedAt: message.openedAt ?? at,
              lastOpenedAt: at,
            },
    })

    if (input.type === 'CLICK') {
      await db.message.updateMany({
        where: { id: message.id, firstClickAt: null },
        data: { firstClickAt: at },
      })
    }
  } catch (error) {
    console.error('[tracking] olay yazilamadi:', error)
  }
}

/** UI'da olay listesinde gosterilen kisa cihaz etiketi. */
export function deviceLabel(userAgent: string | null): string {
  const agent = userAgent ?? ''
  if (!agent) return 'bilinmiyor'
  if (/GoogleImageProxy/i.test(agent)) return 'Gmail'
  if (/iPhone|iPad/i.test(agent)) return 'iPhone/iPad'
  if (/Android/i.test(agent)) return 'Android'
  if (/Macintosh/i.test(agent)) return 'Mac'
  if (/Windows/i.test(agent)) return 'Windows'
  if (/Linux/i.test(agent)) return 'Linux'
  return agent.slice(0, 40)
}
