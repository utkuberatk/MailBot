/**
 * Gonderim kuyrugu ve hiz limitleri.
 *
 * Mailler tek tek, aralarinda 45-90 sn rastgele bekleyerek gonderilir.
 * Saatlik/gunluk limitler ve warm-up asamasi CLAUDE.md bolum 10'daki
 * spam kurallarina uyar. Kuyruk process bellegindedir; uygulama yeniden
 * baslarsa QUEUED kayitlar bir sonraki tetiklemede kaldigi yerden devam eder.
 */

import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { sendMail } from '@/lib/gmail'
import { trackedLink } from '@/lib/tracking'

const DAY = 24 * 60 * 60 * 1000

const WARMUP_KEY = 'warmup_started_at'

/**
 * Isinma kademeleri.
 *
 * Yeni bir Gmail hesabindan birdenbire onlarca soguk mail cikmasi, hesabin
 * itibarini bozan en hizli yoldur. Gunluk hacim kademeli acilir.
 */
const WARMUP_STAGES = [
  { untilDay: 3, daily: 5, hourly: 2, label: 'Isınma: ilk 3 gün' },
  { untilDay: 7, daily: 10, hourly: 3, label: 'Isınma: 1. hafta' },
  { untilDay: 14, daily: 20, hourly: 5, label: 'Isınma: 2. hafta' },
  { untilDay: 21, daily: 35, hourly: 10, label: 'Isınma: 3. hafta' },
]

/**
 * Isinmanin basladigi an.
 *
 * Setting tablosunda tutulur; Message kayitlari sirket silinince cascade ile
 * gittigi icin gonderim gecmisinden hesaplanamaz — oyle olsaydi sirketleri
 * silmek isinma sayacini sifirlar ve hesabi riske atardi.
 */
async function warmupStartedAt(): Promise<Date | null> {
  const setting = await db.setting.findUnique({ where: { key: WARMUP_KEY } })
  if (!setting) return null

  const date = new Date(setting.value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Ilk basarili gonderimde bir kez yazilir. */
async function markWarmupStarted(): Promise<void> {
  const now = new Date().toISOString()
  await db.setting.upsert({
    where: { key: WARMUP_KEY },
    update: {},
    create: { key: WARMUP_KEY, value: now },
  })
}

export type Quota = {
  dailyLimit: number
  hourlyLimit: number
  sentToday: number
  sentThisHour: number
  remainingToday: number
  remainingThisHour: number
  /** Kullaniciya gosterilecek asama adi. */
  stage: string
  warmupDay: number | null
}

/** Kalan gonderim hakki — UI, kuyruk ve Discord ayni fonksiyonu kullanir. */
export async function getQuota(): Promise<Quota> {
  const now = Date.now()
  const configured = env.sendLimits()

  const [started, sentToday, sentThisHour] = await Promise.all([
    warmupStartedAt(),
    db.message.count({ where: { status: 'SENT', sentAt: { gte: new Date(now - DAY) } } }),
    db.message.count({ where: { status: 'SENT', sentAt: { gte: new Date(now - 60 * 60 * 1000) } } }),
  ])

  // Henuz hic gonderim yapilmadiysa ilk kademe gecerlidir.
  const day = started ? Math.floor((now - started.getTime()) / DAY) + 1 : 1
  const stage = WARMUP_STAGES.find((item) => day <= item.untilDay)

  const daily = stage ? Math.min(stage.daily, configured.daily) : configured.daily
  const hourly = stage ? Math.min(stage.hourly, configured.hourly) : configured.hourly

  return {
    dailyLimit: daily,
    hourlyLimit: hourly,
    sentToday,
    sentThisHour,
    remainingToday: Math.max(0, daily - sentToday),
    remainingThisHour: Math.max(0, hourly - sentThisHour),
    stage: stage ? `${stage.label} (${day}. gün)` : 'Tam kapasite',
    warmupDay: started ? day : null,
  }
}

/** Sablondaki degiskenleri sirket bilgileriyle doldurur. */
export function renderTemplate(
  template: string,
  company: { name: string; city?: string | null; sector?: string | null; domain?: string | null },
): string {
  const values: Record<string, string> = {
    company: company.name,
    sirket: company.name,
    city: company.city ?? '',
    sehir: company.city ?? '',
    sector: company.sector ?? '',
    sektor: company.sector ?? '',
    domain: company.domain ?? '',
  }

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = values[key.toLowerCase()]
    return value !== undefined ? value : match
  })
}

/** Sirket adi gecmeyen mail gonderilmez (CLAUDE.md bolum 10). */
export function isPersonalized(body: string, companyName: string): boolean {
  const normalize = (value: string) => value.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim()
  return normalize(body).includes(normalize(companyName))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type MailContent = {
  body: string
  videoUrl?: string | null
  videoThumbUrl?: string | null
  trackingId: string
}

/** Cikis talebini yanit olarak isteyen cumle — takip kapaliyken kullanilir. */
const REPLY_TO_UNSUBSCRIBE =
  'Bu mailleri almak istemiyorsanız bu mesajı yanıtlayıp "çıkar" yazmanız yeterli.'

/**
 * `List-Unsubscribe` baslik degeri.
 *
 * Kendi alan adimiz yoksa mailto: bicimi kullanilir — Gmail bunu destekler,
 * hicbir altyapi gerektirmez ve itibarsiz bir alan adi maile girmez.
 */
export function listUnsubscribeHeader(trackingId: string): { value: string; oneClick: boolean } {
  const trackingUrl = env.mailTrackingUrl()

  if (trackingUrl) {
    return { value: `<${trackingUrl}/api/unsubscribe/${trackingId}>`, oneClick: true }
  }

  const address = env.gmailUser()
  return { value: `<mailto:${address}?subject=Listeden%20cikar>`, oneClick: false }
}

/**
 * Sade HTML govde: tek CTA, attachment yok.
 *
 * Takip kapaliyken (kendi alan adimiz yokken) mailde hicbir gorsel, takip
 * pikseli veya bize ait link bulunmaz — spam filtrelerinin en cok tepki
 * verdigi seyler bunlar.
 */
export function buildHtml(content: MailContent): string {
  const trackingUrl = env.mailTrackingUrl()
  const sender = env.sender()

  const paragraphs = content.body
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block.trim()).replace(/\n/g, '<br>'))
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 14px">${block}</p>`)
    .join('')

  // Tek CTA linki takip acikken kendi alan adimiz uzerinden gecirilir; boylece
  // tiklama kaydedilir. Takip kapaliyken adres oldugu gibi kalir (YouTube linki
  // YouTube linki olarak gider) — itibarsiz bir alan adi maile hic girmez.
  const videoHref = content.videoUrl ? trackedLink(content.trackingId, content.videoUrl) : ''

  // Gorsel yalnizca kendi alan adimizdan servis edilebiliyorsa gomulur;
  // aksi halde videonun kendi adresine (YouTube/Vimeo) duz bir link verilir.
  const video = !content.videoUrl
    ? ''
    : trackingUrl && content.videoThumbUrl
      ? `<p style="margin:0 0 18px"><a href="${escapeHtml(videoHref)}">` +
        `<img src="${escapeHtml(content.videoThumbUrl)}" alt="Videoyu izleyin" ` +
        `width="480" style="max-width:100%;border-radius:8px;display:block"></a></p>`
      : `<p style="margin:0 0 18px"><a href="${escapeHtml(videoHref)}" ` +
        `style="color:#2563eb">Kısa videoyu izleyin</a></p>`

  const signature = [sender.name, sender.title, sender.address]
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br>')

  const unsubscribe = trackingUrl
    ? `Bu maili almak istemiyorsanız <a href="${trackingUrl}/api/unsubscribe/${content.trackingId}" style="color:#9ca3af">listeden çıkabilirsiniz</a>.`
    : escapeHtml(REPLY_TO_UNSUBSCRIBE)

  const pixel = trackingUrl
    ? `\n<img src="${trackingUrl}/api/track/${content.trackingId}" width="1" height="1" alt="" style="display:block">`
    : ''

  return `<!doctype html>
<html lang="tr"><body style="margin:0;padding:0;background:#ffffff">
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:560px;padding:8px">
${paragraphs}
${video}
<p style="margin:24px 0 0;color:#4b5563;font-size:14px">${signature}</p>
<p style="margin:18px 0 0;color:#9ca3af;font-size:12px">
${unsubscribe}
</p>${pixel}
</div></body></html>`
}

/** HTML'siz istemciler icin duz metin surumu. */
export function buildText(content: MailContent): string {
  const trackingUrl = env.mailTrackingUrl()
  const sender = env.sender()
  const parts = [content.body.trim()]

  if (content.videoUrl) parts.push(`Video: ${trackedLink(content.trackingId, content.videoUrl)}`)
  parts.push([sender.name, sender.title, sender.address].filter(Boolean).join('\n'))
  parts.push(
    trackingUrl
      ? `Listeden çıkmak için: ${trackingUrl}/api/unsubscribe/${content.trackingId}`
      : REPLY_TO_UNSUBSCRIBE,
  )

  return parts.join('\n\n')
}

export type QueueResult = {
  queued: number
  skipped: { company: string; reason: string }[]
}

/**
 * Secili sirketler icin QUEUED mesaj kayitlari acar.
 * E-postasi olmayan, pasif veya kisisellestirilmemis olanlar atlanir.
 */
export async function queueCampaign(
  campaignId: number,
  companyIds: number[],
): Promise<QueueResult> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw new Error('Kampanya bulunamadı.')

  const companies = await db.company.findMany({ where: { id: { in: companyIds } } })
  const skipped: QueueResult['skipped'] = []
  let queued = 0

  for (const company of companies) {
    if (!company.isActive) {
      skipped.push({ company: company.name, reason: 'Pasif kayıt (bounce/çıkış)' })
      continue
    }
    if (!company.email) {
      skipped.push({ company: company.name, reason: 'E-posta adresi yok' })
      continue
    }

    const body = renderTemplate(campaign.bodyTemplate, company)
    if (!isPersonalized(body, company.name)) {
      skipped.push({ company: company.name, reason: 'Mail metninde şirket adı geçmiyor' })
      continue
    }

    const already = await db.message.findFirst({
      where: { companyId: company.id, campaignId, status: { in: ['QUEUED', 'SENT'] } },
    })
    if (already) {
      skipped.push({ company: company.name, reason: 'Bu kampanya zaten gönderilmiş' })
      continue
    }

    const trackingId = randomUUID()
    const content: MailContent = {
      body,
      videoUrl: campaign.videoUrl,
      videoThumbUrl:
        campaign.videoThumbPath && env.mailTrackingUrl()
          ? `${env.mailTrackingUrl()}${campaign.videoThumbPath}`
          : null,
      trackingId,
    }

    await db.message.create({
      data: {
        companyId: company.id,
        campaignId,
        toEmail: company.email,
        subject: renderTemplate(campaign.subject, company),
        bodyHtml: buildHtml(content),
        trackingId,
        status: 'QUEUED',
      },
    })
    queued++
  }

  return { queued, skipped }
}

let workerRunning = false

function randomDelay(): number {
  const { minDelaySeconds, maxDelaySeconds } = env.sendLimits()
  const min = Math.max(1, minDelaySeconds)
  const max = Math.max(min, maxDelaySeconds)
  return (min + Math.random() * (max - min)) * 1000
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Bir QUEUED mesaji gonderir. */
async function sendOne(message: {
  id: number
  toEmail: string
  subject: string
  bodyHtml: string
  trackingId: string
  campaignId: number | null
  companyId: number
}) {
  const campaign = message.campaignId
    ? await db.campaign.findUnique({ where: { id: message.campaignId } })
    : null
  const company = await db.company.findUnique({ where: { id: message.companyId } })

  const content: MailContent = {
    body: campaign && company ? renderTemplate(campaign.bodyTemplate, company) : '',
    videoUrl: campaign?.videoUrl,
    videoThumbUrl:
      campaign?.videoThumbPath && env.mailTrackingUrl()
        ? `${env.mailTrackingUrl()}${campaign.videoThumbPath}`
        : null,
    trackingId: message.trackingId,
  }

  const unsubscribe = listUnsubscribeHeader(message.trackingId)

  // bodyHtml kuyruga alma aninda donar. Takip sonradan acildiysa kuyrukta
  // bekleyen mailler pikselsiz giderdi — bu durumda HTML yeniden uretilir.
  const html =
    env.trackingEnabled() && content.body && !message.bodyHtml.includes('/api/track/')
      ? buildHtml(content)
      : message.bodyHtml

  try {
    const sent = await sendMail({
      to: message.toEmail,
      subject: message.subject,
      html,
      text: buildText(content),
      listUnsubscribe: unsubscribe.value,
      listUnsubscribeOneClick: unsubscribe.oneClick,
    })

    await db.message.update({
      where: { id: message.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        gmailMessageId: sent.id,
        gmailThreadId: sent.threadId,
        bodyHtml: html,
        error: null,
      },
    })

    await markWarmupStarted()
    return true
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)

    await db.message.update({
      where: { id: message.id },
      data: { status: 'FAILED', error: text.slice(0, 500) },
    })

    // Adres gecersizse bir daha denenmesin.
    if (/invalid|not found|no such user|550/i.test(text)) {
      await db.company.update({ where: { id: message.companyId }, data: { isActive: false } })
    }
    return false
  }
}

export type WorkerState = { running: boolean; sent: number; failed: number; stoppedBy?: string }

let lastRun: WorkerState = { running: false, sent: 0, failed: 0 }

export function workerState(): WorkerState {
  return lastRun
}

/**
 * Kuyrugu isler. Ayni anda tek isci calisir; tekrar cagrilirsa mevcut durum doner.
 */
export async function runQueue(): Promise<WorkerState> {
  if (workerRunning) return lastRun

  workerRunning = true
  lastRun = { running: true, sent: 0, failed: 0 }

  try {
    for (;;) {
      const quota = await getQuota()
      if (quota.remainingToday <= 0) {
        lastRun.stoppedBy = `Günlük limit doldu (${quota.dailyLimit}). Yarın devam edilecek.`
        break
      }
      if (quota.remainingThisHour <= 0) {
        lastRun.stoppedBy = `Saatlik limit doldu (${quota.hourlyLimit}). Bir saat sonra devam edin.`
        break
      }

      const next = await db.message.findFirst({
        where: { status: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
      })
      if (!next) break

      const ok = await sendOne(next)
      if (ok) lastRun.sent++
      else lastRun.failed++

      const remaining = await db.message.count({ where: { status: 'QUEUED' } })
      if (remaining > 0) await wait(randomDelay())
    }
  } finally {
    workerRunning = false
    lastRun.running = false
  }

  return lastRun
}

/** Kuyrugu arka planda baslatir — HTTP istegi beklemez. */
export function startQueue(): void {
  if (workerRunning) return
  void runQueue().catch((error) => {
    console.error('[mailer] kuyruk hatasi:', error)
  })
}
