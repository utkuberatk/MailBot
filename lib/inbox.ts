/**
 * Gelen kutusu senkronizasyonu.
 *
 * Son 30 gundeki IMAP iletileri salt okunur taranir. In-Reply-To ve References
 * basliklari gonderilmis RFC Message-ID degerleriyle eslestirilir; yeni yanitlar
 * Reply olarak kaydedilir ve Groq ile duygu analizi yapilir.
 * n8n bu isi 3 dakikada bir /api/jobs/sync-inbox uzerinden tetikler.
 */

import { db } from '@/lib/db'
import {
  deduplicateIncomingMessages,
  fetchIncomingMessages,
  incomingReferenceIds,
  type IncomingMail,
} from '@/lib/email'
import { env } from '@/lib/env'
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
    // Kisisel moddaki cikis cumlesinin ("ilgilenmiyorum yazin") karsiliklari.
    /ilgilenmiyor/,
    /ilgilenmedik/,
    /ilgimizi\s+cekmi/,
    /yazmay(in|iniz)/,
    /gonderme(yin|yiniz)/,
  ]

  return patterns.some((pattern) => pattern.test(normalized))
}

/** Gelen iletinin en yakin RFC referansini kok Message kaydina esler. */
export function findReferencedMessageId(
  incoming: IncomingMail,
  referenceToMessage: ReadonlyMap<string, number>,
): number | null {
  for (const reference of incomingReferenceIds(incoming)) {
    const messageId = referenceToMessage.get(reference)
    if (messageId !== undefined) return messageId
  }
  return null
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

/** Son 30 gunde SMTP ile gonderilmis mailler icin IMAP yanitlarini tarar. */
export async function syncInbox(): Promise<SyncResult> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const messages = await db.message.findMany({
    where: {
      status: 'SENT',
      sentAt: { gte: since },
      OR: [{ rfcMessageId: { not: null } }, { emailReferences: { some: {} } }],
    },
    select: {
      id: true,
      rfcMessageId: true,
      toEmail: true,
      emailReferences: { select: { rfcMessageId: true } },
    },
  })

  const result: SyncResult = {
    scanned: messages.length,
    newReplies: 0,
    positive: 0,
    optOuts: 0,
    errors: [],
  }

  // Eski Gmail kayitlarinda rfcMessageId null oldugundan yeni IMAP akisini etkilemez.
  if (messages.length === 0) return result

  const referenceToMessage = new Map<string, number>()
  for (const message of messages) {
    if (message.rfcMessageId) referenceToMessage.set(message.rfcMessageId, message.id)
    for (const reference of message.emailReferences) {
      referenceToMessage.set(reference.rfcMessageId, message.id)
    }
  }

  let incoming: IncomingMail[]
  try {
    incoming = await fetchIncomingMessages(since)
  } catch (error) {
    result.errors.push(
      `Gelen kutusu okunamadi: ${error instanceof Error ? error.message : String(error)}`,
    )
    return result
  }

  const rfcIds = incoming.flatMap((item) => (item.rfcMessageId ? [item.rfcMessageId] : []))
  const imapKeys = incoming.map((item) => item.imapKey)
  const [existingByRfc, existingByImap] = await Promise.all([
    rfcIds.length
      ? db.reply.findMany({
          where: { rfcMessageId: { in: rfcIds } },
          select: { rfcMessageId: true, imapKey: true },
        })
      : Promise.resolve([]),
    imapKeys.length
      ? db.reply.findMany({
          where: { imapKey: { in: imapKeys } },
          select: { rfcMessageId: true, imapKey: true },
        })
      : Promise.resolve([]),
  ])

  const existingRfc = [...existingByRfc, ...existingByImap].flatMap((item) =>
    item.rfcMessageId ? [item.rfcMessageId] : [],
  )
  const existingImap = [...existingByRfc, ...existingByImap].flatMap((item) =>
    item.imapKey ? [item.imapKey] : [],
  )
  const candidates = deduplicateIncomingMessages(incoming, existingRfc, existingImap)
  const ownAddresses = new Set([
    env.imap().user.trim().toLowerCase(),
    env.sender().address.trim().toLowerCase(),
  ])

  for (const reply of candidates) {
    const messageId = findReferencedMessageId(reply, referenceToMessage)
    if (!messageId || !reply.text.trim() || !reply.fromEmail || ownAddresses.has(reply.fromEmail)) {
      continue
    }

    let analysis: ReplyAnalysis = { sentiment: 'NEUTRAL', score: 0, summary: '' }
    try {
      analysis = await analyzeReply(reply.text)
    } catch (error) {
      result.errors.push(
        `Analiz basarisiz (${reply.fromEmail}): ${error instanceof Error ? error.message : error}`,
      )
    }

    const optOut = isOptOutRequest(reply.text)

    try {
      await db.$transaction(async (tx) => {
        await tx.reply.create({
          data: {
            messageId,
            fromEmail: reply.fromEmail,
            bodyText: reply.text.slice(0, 8000),
            rfcMessageId: reply.rfcMessageId,
            imapKey: reply.imapKey,
            inReplyTo: reply.inReplyTo,
            references: reply.references.join(' ') || null,
            receivedAt: reply.receivedAt,
            sentiment: analysis.sentiment,
            sentimentScore: analysis.score,
            summary: analysis.summary || null,
          },
        })

        if (reply.rfcMessageId) {
          await tx.emailThreadReference.create({
            data: { messageId, rfcMessageId: reply.rfcMessageId, direction: 'INBOUND' },
          })
        }

        if (optOut || analysis.sentiment === 'NEGATIVE') {
          await tx.message.update({
            where: { id: messageId },
            data: {
              company: {
                update: {
                  isActive: false,
                  notes: optOut ? 'Yanıtla listeden çıkış talebi' : 'Olumsuz yanıt',
                },
              },
            },
          })
        }
      })
    } catch (error) {
      // Paralel iki sync ayni IMAP iletisini gorurse unique alanlar ikinci yazimi eler.
      if (isUniqueConstraintError(error)) continue
      result.errors.push(
        `Yanit kaydedilemedi (${reply.fromEmail}): ${error instanceof Error ? error.message : error}`,
      )
      continue
    }

    if (reply.rfcMessageId) referenceToMessage.set(reply.rfcMessageId, messageId)
    result.newReplies++
    if (analysis.sentiment === 'POSITIVE') result.positive++
    if (optOut) result.optOuts++
  }

  return result
}
