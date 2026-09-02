import { env } from '@/lib/env'

/**
 * Groq API istemcisi.
 *
 * Ucretsiz katmanda dakikada ~30 istek siniri var; bu yuzden istekler
 * sirayla gonderilir ve 429 durumunda kisa bir bekleme ile tekrar denenir.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

type Message = { role: 'system' | 'user'; content: string }

/** Ayni anda tek istek: ucretsiz katman limitini asmamak icin basit kuyruk. */
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task)
  queue = result.catch(() => undefined)
  return result
}

async function chat(messages: Message[], { json = true } = {}): Promise<string> {
  return enqueue(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.groqApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.groqModel(),
          messages,
          temperature: 0.3,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      })

      if (response.status === 429) {
        const wait = Number(response.headers.get('retry-after') ?? 3) * 1000
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 15_000)))
        continue
      }

      if (!response.ok) {
        throw new Error(`Groq API hatasi ${response.status}: ${await response.text()}`)
      }

      const data = await response.json()
      return data.choices?.[0]?.message?.content ?? ''
    }

    throw new Error('Groq istek limiti asildi, birkac dakika sonra tekrar deneyin.')
  })
}

/** JSON bekleyen cagrilar icin: model bazen metni kod blogu icinde dondurur. */
function parseJson<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  return JSON.parse(cleaned) as T
}

/** Kullanicinin promptundan arama motoru sorgulari uretir. */
export async function buildSearchQueries(prompt: string): Promise<string[]> {
  const raw = await chat([
    {
      role: 'system',
      content:
        'Turkiye pazarinda e-ticaret yapan sirketleri bulmak icin arama motoru sorgulari uretirsin. ' +
        'Sadece JSON dondur: {"queries": ["...", "..."]}. ' +
        '3-5 adet, Turkce, birbirinden farkli ve spesifik sorgu uret. ' +
        'Sorgular firmalarin kendi web sitelerini bulmaya yonelik olsun; pazaryeri urun sayfalarina degil.',
    },
    { role: 'user', content: prompt },
  ])

  const parsed = parseJson<{ queries?: unknown }>(raw)
  const queries = Array.isArray(parsed.queries) ? parsed.queries : []
  return queries.filter((q): q is string => typeof q === 'string' && q.trim() !== '').slice(0, 5)
}

export type ClassifiedSite = {
  name: string
  isEcommerce: boolean
  sector: string | null
  city: string | null
  confidence: number
}

/** Bir sitenin e-ticaret olup olmadigini ve sektorunu belirler. */
export async function classifyCompany(input: {
  domain: string
  title: string
  text: string
}): Promise<ClassifiedSite> {
  const raw = await chat([
    {
      role: 'system',
      content:
        'Bir web sitesinin metnine bakip sirketi siniflandirirsin. Sadece JSON dondur: ' +
        '{"name": "sirket adi", "isEcommerce": true/false, "sector": "kisa sektor", ' +
        '"city": "sehir veya null", "confidence": 0-1 arasi sayi}. ' +
        'isEcommerce: site internet uzerinden urun satiyorsa true. ' +
        'Blog, haber, forum, kurumsal tanitim veya pazaryeri ise false. ' +
        'Bilgi yoksa null dondur, uydurma.',
    },
    {
      role: 'user',
      content: `Alan adi: ${input.domain}\nBaslik: ${input.title}\n\nMetin:\n${input.text.slice(0, 3000)}`,
    },
  ])

  const parsed = parseJson<Partial<ClassifiedSite>>(raw)
  return {
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : input.domain,
    isEcommerce: parsed.isEcommerce === true,
    sector: typeof parsed.sector === 'string' ? parsed.sector : null,
    city: typeof parsed.city === 'string' ? parsed.city : null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  }
}

export type ImprovedEmail = {
  subject: string
  body: string
  spamScore: number
  warnings: string[]
}

/** Kullanicinin mail taslagini iyilestirir. Niyeti ve tonu degistirmez. */
export async function improveEmail(input: {
  draft: string
  subject: string
  company: { name: string; sector?: string | null; city?: string | null }
}): Promise<ImprovedEmail> {
  const raw = await chat([
    {
      role: 'system',
      content:
        'Turkce is maillerini duzenleyen bir editorsun. Sadece JSON dondur: ' +
        '{"subject": "...", "body": "...", "spamScore": 0-1, "warnings": ["..."]}.\n' +
        'Kurallar:\n' +
        '- Kullanicinin niyetini, teklifini ve tonunu KORU. Yeni iddia, rakam veya vaat EKLEME.\n' +
        '- Sadece dili, akisi ve nezaketi duzelt. Kisa ve net tut (en fazla 150 kelime).\n' +
        '- Sirket adini dogal bicimde metne yerlestir.\n' +
        '- Abartili pazarlama dili, cok sayida unlem ve buyuk harf bloklari kullanma.\n' +
        '- spamScore: mailin spam olarak algilanma riski (0 dusuk, 1 yuksek).\n' +
        '- warnings: spam riskini artiran somut ifadeler (yoksa bos dizi).',
    },
    {
      role: 'user',
      content:
        `Alici sirket: ${input.company.name}` +
        (input.company.sector ? ` (${input.company.sector})` : '') +
        (input.company.city ? ` — ${input.company.city}` : '') +
        `\n\nKonu: ${input.subject}\n\nTaslak:\n${input.draft}`,
    },
  ])

  const parsed = parseJson<Partial<ImprovedEmail>>(raw)
  return {
    subject: typeof parsed.subject === 'string' ? parsed.subject : input.subject,
    body: typeof parsed.body === 'string' ? parsed.body : input.draft,
    spamScore: typeof parsed.spamScore === 'number' ? parsed.spamScore : 0,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
  }
}

export type ReplyAnalysis = {
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'
  score: number
  summary: string
}

/** Gelen yaniti siniflandirir. */
export async function analyzeReply(text: string): Promise<ReplyAnalysis> {
  const raw = await chat([
    {
      role: 'system',
      content:
        'Soguk maile gelen yanitlari siniflandirirsin. Sadece JSON dondur: ' +
        '{"sentiment": "POSITIVE"|"NEUTRAL"|"NEGATIVE", "score": 0-1, "summary": "tek cumle Turkce ozet"}.\n' +
        'POSITIVE: ilgi var, bilgi/teklif/gorusme istiyor.\n' +
        'NEUTRAL: otomatik yanit, bilgi talebi disi, belirsiz.\n' +
        'NEGATIVE: ilgilenmiyor, listeden cikma talebi, olumsuz.',
    },
    { role: 'user', content: text.slice(0, 4000) },
  ])

  const parsed = parseJson<Partial<ReplyAnalysis>>(raw)
  const sentiment =
    parsed.sentiment === 'POSITIVE' || parsed.sentiment === 'NEGATIVE' ? parsed.sentiment : 'NEUTRAL'

  return {
    sentiment,
    score: typeof parsed.score === 'number' ? parsed.score : 0,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  }
}

/** Kullanicinin kisa yanitini, Gmail'den elle yazilmis gibi duzenler. */
export async function polishReply(input: {
  text: string
  context: string
  senderName?: string
}): Promise<string> {
  const raw = await chat([
    {
      role: 'system',
      content:
        'Turkce is yazismasi editorusun. Sadece JSON dondur: {"body": "..."}.\n' +
        'Kullanicinin kisa notunu, karsi tarafin mailine verilen dogal bir yanita cevir.\n' +
        'Kurallar: niyeti KORU, yeni bilgi/taahhut EKLEME, kisa tut, samimi ve profesyonel ol, ' +
        'yapay zeka tarafindan yazildigi belli olmasin, imza satirini sen ekleme.',
    },
    {
      role: 'user',
      content: `Karsi tarafin maili:\n${input.context.slice(0, 2000)}\n\nBenim notum:\n${input.text}`,
    },
  ])

  const parsed = parseJson<{ body?: string }>(raw)
  return typeof parsed.body === 'string' ? parsed.body : input.text
}
