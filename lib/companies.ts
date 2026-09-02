import { db } from '@/lib/db'

/** Kesif sirasinda atlanacak alan adlari: pazaryerleri, sosyal medya, platformlar. */
const BLOCKED_DOMAINS = [
  'trendyol.com',
  'hepsiburada.com',
  'n11.com',
  'amazon.com',
  'amazon.com.tr',
  'ciceksepeti.com',
  'gittigidiyor.com',
  'sahibinden.com',
  'letgo.com',
  'dolap.com',
  'instagram.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'pinterest.com',
  'youtube.com',
  'tiktok.com',
  'wikipedia.org',
  'google.com',
  'blogspot.com',
  'wordpress.com',
  'medium.com',
  'shopify.com',
  'ikas.com',
  'ideasoft.com.tr',
  'ticimax.com',
  'etsy.com',
  'eksisozluk.com',
  'sikayetvar.com',
]

/** Kisi/kurum maili olmayan adres kaliplari. */
const JUNK_EMAIL_PATTERNS = [
  'noreply',
  'no-reply',
  'donotreply',
  'example.com',
  'example.org',
  'sentry.io',
  'wixpress',
  'yourdomain',
  'domain.com',
  'email.com',
  'test@',
  'user@',
  // Altyapi saglayicilarinin sablon adresleri — sirkete ait degil.
  'eticaretsitesi.com',
  'ideasoft.com.tr',
  'ticimax.com',
  'platinmarket.com',
  'projesoft.com.tr',
  'tsoft.com.tr',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
]

/** URL veya alan adindan sadeleştirilmiş alan adı üretir (www yok, küçük harf). */
export function normalizeDomain(input: string): string | null {
  if (!input) return null
  try {
    const withProtocol = input.includes('://') ? input : `https://${input}`
    const host = new URL(withProtocol).hostname.toLowerCase()
    return host.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export function isBlockedDomain(domain: string): boolean {
  return BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))
}

export function isJunkEmail(email: string): boolean {
  const value = email.toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) return true
  return JUNK_EMAIL_PATTERNS.some((pattern) => value.includes(pattern))
}

export type IncomingCompany = {
  name?: string
  website?: string
  domain?: string
  email?: string
  phone?: string
  city?: string
  sector?: string
  rawSnippet?: string
  score?: number
  isEcommerce?: boolean
}

export type UpsertResult = { created: number; updated: number; skipped: number }

/**
 * Kesiften gelen sirketleri kaydeder.
 * Alan adi benzersiz oldugu icin ayni sirket tekrar bulunursa guncellenir;
 * elle girilen bilgiler (email/telefon) bos degilse ustune yazilmaz.
 */
export async function upsertCompanies(
  items: IncomingCompany[],
  options: { source?: string; discoveryRunId?: number } = {},
): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, updated: 0, skipped: 0 }
  const source = options.source ?? 'n8n'

  for (const item of items) {
    const domain = normalizeDomain(item.domain || item.website || '')
    if (!domain || isBlockedDomain(domain)) {
      result.skipped++
      continue
    }

    const email = item.email && !isJunkEmail(item.email) ? item.email.toLowerCase() : null
    const name = (item.name || domain).trim()

    const existing = await db.company.findUnique({ where: { domain } })

    if (existing) {
      await db.company.update({
        where: { domain },
        data: {
          name: existing.name || name,
          email: existing.email || email,
          phone: existing.phone || item.phone || null,
          city: existing.city || item.city || null,
          sector: existing.sector || item.sector || null,
          website: existing.website || item.website || `https://${domain}`,
          score: item.score ?? existing.score,
          rawSnippet: existing.rawSnippet || item.rawSnippet || null,
        },
      })
      result.updated++
      continue
    }

    await db.company.create({
      data: {
        name,
        domain,
        website: item.website || `https://${domain}`,
        email,
        phone: item.phone || null,
        city: item.city || null,
        sector: item.sector || null,
        rawSnippet: item.rawSnippet?.slice(0, 1000) || null,
        score: item.score ?? null,
        isEcommerce: item.isEcommerce ?? true,
        source,
        discoveryRunId: options.discoveryRunId ?? null,
      },
    })
    result.created++
  }

  return result
}
