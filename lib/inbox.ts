/**
 * Gelen kutusu senkronizasyonu.
 *
 * Gonderilmis her mailin Gmail thread'i taranir, bize gelen yeni yanitlar
 * Reply olarak kaydedilir ve Groq ile duygu analizi yapilir.
 * n8n bu isi 3 dakikada bir /api/jobs/sync-inbox uzerinden tetikler.
 */

import { db } from '@/lib/db'
import { getThreadReplies } from '@/lib/gmail'
import { analyzeReply, type ReplyAnalysis } from '@/lib/groq'

export type SyncResult = {
  scanned: number
  newReplies: number
  positive: number
  optOuts: number
  errors: string[]
}

/**
 * Listeden cikis talebi mi?
 *
 * Kendi alan adimiz yokken cikis linki yerine "yanitlayip cikar yazin"
 * deniyor; bu yuzden talep duz metinden yakalanmali. Groq'un NEGATIVE
 * demesini beklemeyiz — talep kacirilirsa ayni adrese tekrar mail gider.
 */
export function isOptOutRequest(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')

  const patterns = [
    /\bcikar\b/,
    /\bcikart\w*/,
    /listeden\s+cik/,
    /listenizden/,
    /unsubscribe/,
    /abonelik\w*\s+iptal/,
    /bir\s+daha\s+(mail|e-?posta|mesaj)/,
    /(mail|e-?posta|mesaj)\s+g[oö]nderme/,
    /rahatsiz\s+etmey/,
    /\bspam\b/,
  ]

  return patterns.some((pattern) => pattern.test(normalized))
}

/** Son 30 gunde gonderilmis mailleri tarar. */
export async function syncInbox(): Promise<SyncResult> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const messages = await db.message.findMany({
    where: { status: 'SENT', gmailThreadId: { not: null }, sentAt: { gte: since } },
    select: { id: true, gmailThreadId: true, toEmail: true },
  })

  const result: SyncResult = {
    scanned: messages.length,
    newReplies: 0,
    positive: 0,
    optOuts: 0,
    errors: [],
  }

  for (const message of messages) {
    try {
      const replies = await getThreadReplies(message.gmailThreadId!)

      for (const reply of replies) {
        // gmailMessageId unique — ayni yanit iki kez islenmez.
        const exists = await db.reply.findUnique({ where: { gmailMessageId: reply.messageId } })
        if (exists) continue
        if (!reply.text.trim()) continue

        let analysis: ReplyAnalysis = { sentiment: 'NEUTRAL', score: 0, summary: '' }
        try {
          analysis = await analyzeReply(reply.text)
        } catch (error) {
          result.errors.push(
            `Analiz basarisiz (${reply.fromEmail}): ${error instanceof Error ? error.message : error}`,
          )
        }

        await db.reply.create({
          data: {
            messageId: message.id,
            fromEmail: reply.fromEmail,
            bodyText: reply.text.slice(0, 8000),
            gmailMessageId: reply.messageId,
            receivedAt: reply.receivedAt,
            sentiment: analysis.sentiment,
            sentimentScore: analysis.score,
            summary: analysis.summary || null,
          },
        })

        result.newReplies++
        if (analysis.sentiment === 'POSITIVE') result.positive++

        // Cikis talebi ve olumsuz yanit gelen adrese bir daha gonderme.
        // Cikis artik mail yanitiyla yapildigi icin anahtar kelime kontrolu
        // AI'in kararindan bagimsiz calisir — talep kacirilmamali.
        const optOut = isOptOutRequest(reply.text)
        if (optOut || analysis.sentiment === 'NEGATIVE') {
          await db.message.update({
            where: { id: message.id },
            data: {
              company: {
                update: {
                  isActive: false,
                  notes: optOut ? 'Yanıtla listeden çıkış talebi' : 'Olumsuz yanıt',
                },
              },
            },
          })
          if (optOut) result.optOuts++
        }
      }
    } catch (error) {
      result.errors.push(
        `Thread okunamadi (${message.toEmail}): ${error instanceof Error ? error.message : error}`,
      )
    }
  }

  return result
}
