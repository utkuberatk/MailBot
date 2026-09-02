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

const DAY = 24 * 60 * 60 * 1000

/** Warm-up: ilk hafta 10, ikinci hafta 25, sonrasinda .env limiti. */
async function dailyLimit(): Promise<number> {
  const configured = env.sendLimits().daily
  const first = await db.message.findFirst({
    where: { sentAt: { not: null } },
    orderBy: { sentAt: 'asc' },
    select: { sentAt: true },
  })

  if (!first?.sentAt) return Math.min(10, configured)

  const days = (Date.now() - first.sentAt.getTime()) / DAY
  if (days < 7) return Math.min(10, configured)
  if (days < 14) return Math.min(25, configured)
  return configured
}

export type Quota = {
  dailyLimit: number
  hourlyLimit: number
  sentToday: number
  sentThisHour: number
  remainingToday: number
  remainingThisHour: number
}

/** Kalan gonderim hakki — UI ve kuyruk ayni fonksiyonu kullanir. */
export async function getQuota(): Promise<Quota> {
  const now = Date.now()
  const [daily, sentToday, sentThisHour] = await Promise.all([
    dailyLimit(),
    db.message.count({ where: { status: 'SENT', sentAt: { gte: new Date(now - DAY) } } }),
    db.message.count({ where: { status: 'SENT', sentAt: { gte: new Date(now - 60 * 60 * 1000) } } }),
  ])

  const hourly = env.sendLimits().hourly

  return {
    dailyLimit: daily,
    hourlyLimit: hourly,
    sentToday,
    sentThisHour,
    remainingToday: Math.max(0, daily - sentToday),
    remainingThisHour: Math.max(0, hourly - sentThisHour),
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

/**
 * Sade HTML govde: tek CTA, en fazla bir gorsel, attachment yok.
 * Sonunda imza, cikis linki ve 1x1 takip pikseli.
 */
export function buildHtml(content: MailContent): string {
  const appUrl = env.publicUrl()
  const sender = env.sender()
  const unsubscribeUrl = `${appUrl}/api/unsubscribe/${content.trackingId}`

  const paragraphs = content.body
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block.trim()).replace(/\n/g, '<br>'))
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 14px">${block}</p>`)
    .join('')

  const video =
    content.videoUrl && content.videoThumbUrl
      ? `<p style="margin:0 0 18px"><a href="${escapeHtml(content.videoUrl)}">` +
        `<img src="${escapeHtml(content.videoThumbUrl)}" alt="Videoyu izleyin" ` +
        `width="480" style="max-width:100%;border-radius:8px;display:block"></a></p>`
      : content.videoUrl
        ? `<p style="margin:0 0 18px"><a href="${escapeHtml(content.videoUrl)}" ` +
          `style="color:#2563eb">Kısa videoyu izleyin</a></p>`
        : ''

  const signature = [sender.name, sender.title, sender.address]
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br>')

  return `<!doctype html>
<html lang="tr"><body style="margin:0;padding:0;background:#ffffff">
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:560px;padding:8px">
${paragraphs}
${video}
<p style="margin:24px 0 0;color:#4b5563;font-size:14px">${signature}</p>
<p style="margin:18px 0 0;color:#9ca3af;font-size:12px">
Bu maili almak istemiyorsanız <a href="${unsubscribeUrl}" style="color:#9ca3af">listeden çıkabilirsiniz</a>.
</p>
<img src="${appUrl}/api/track/${content.trackingId}" width="1" height="1" alt="" style="display:block">
</div></body></html>`
}

/** HTML'siz istemciler icin duz metin surumu. */
export function buildText(content: MailContent): string {
  const sender = env.sender()
  const parts = [content.body.trim()]

  if (content.videoUrl) parts.push(`Video: ${content.videoUrl}`)
  parts.push([sender.name, sender.title, sender.address].filter(Boolean).join('\n'))
  parts.push(`Listeden çıkmak için: ${env.publicUrl()}/api/unsubscribe/${content.trackingId}`)

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
      videoThumbUrl: campaign.videoThumbPath
        ? `${env.publicUrl()}${campaign.videoThumbPath}`
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
    videoThumbUrl: campaign?.videoThumbPath ? `${env.publicUrl()}${campaign.videoThumbPath}` : null,
    trackingId: message.trackingId,
  }

  try {
    const sent = await sendMail({
      to: message.toEmail,
      subject: message.subject,
      html: message.bodyHtml,
      text: buildText(content),
      unsubscribeUrl: `${env.publicUrl()}/api/unsubscribe/${message.trackingId}`,
    })

    await db.message.update({
      where: { id: message.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        gmailMessageId: sent.id,
        gmailThreadId: sent.threadId,
        error: null,
      },
    })
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
