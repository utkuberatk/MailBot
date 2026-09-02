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

/**
 * Ucretsiz mail saglayicilari. Bu alan adlari bir sirketi temsil etmez:
 * bir @gmail.com adresinden alan adi turetilirse butun gmail kullanicilari
 * ayni "gmail.com" kaydina cakisir.
 */
const FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.tr',
  'outlook.com',
  'outlook.com.tr',
  'live.com',
  'msn.com',
  'windowslive.com',
  'yahoo.com',
  'yahoo.com.tr',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'yandex.com',
  'yandex.com.tr',
  'yandex.ru',
  'mail.ru',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.net',
  'zoho.com',
  'mynet.com',
  'superonline.com',
  'ttmail.com',
  'turk.net',
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

/** gmail/hotmail gibi ucretsiz saglayicilar sirket alan adi sayilmaz. */
export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.includes(domain)
}

/**
 * Bir sirketin benzersiz alan adini hesaplar.
 * Once site adresi denenir; site yoksa e-postadan turetilir ama
 * ucretsiz saglayicilar (gmail.com vb.) alan adi olarak kullanilmaz —
 * aksi halde farkli sirketler ayni kayda cakisir.
 */
export function companyDomain(website?: string | null, email?: string | null): string | null {
  const fromWebsite = normalizeDomain(website ?? '')
  if (fromWebsite) return fromWebsite

  const emailDomain = normalizeDomain(email?.split('@')[1] ?? '')
  if (!emailDomain || isFreeEmailDomain(emailDomain)) return null
  return emailDomain
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
    const domain = companyDomain(item.domain || item.website, item.email)
    if (domain && isBlockedDomain(domain)) {
      result.skipped++
      continue
    }

    const email = item.email && !isJunkEmail(item.email) ? item.email.toLowerCase() : null
    // Alan adi yoksa (orn. sadece gmail adresi) kayit e-postasiyla ayirt edilir.
    if (!domain && !email) {
      result.skipped++
      continue
    }

    const name = (item.name || domain || email || '').trim()

    const existing = domain
      ? await db.company.findUnique({ where: { domain } })
      : await db.company.findFirst({ where: { email } })

    if (existing) {
      await db.company.update({
        where: { id: existing.id },
        data: {
          name: existing.name || name,
          email: existing.email || email,
          phone: existing.phone || item.phone || null,
          city: existing.city || item.city || null,
          sector: existing.sector || item.sector || null,
          website: existing.website || item.website || (domain ? `https://${domain}` : null),
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
        website: item.website || (domain ? `https://${domain}` : null),
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
