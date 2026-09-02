import { db } from '@/lib/db'
import { isInternalRequest, unauthorized } from '@/lib/auth'
import { polishReply } from '@/lib/groq'
import { sendMail, getMessageIdHeader } from '@/lib/gmail'
import { env } from '@/lib/env'

/**
 * Gelen bir yanita cevap gonderir.
 * Govde: { text, polish?: boolean } — polish varsayilan true (Groq duzeltir).
 * Discord botu ve UI ayni ucu kullanir.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isInternalRequest(request)) return unauthorized()

  const { id } = await params
  const replyId = Number(id)
  if (!Number.isFinite(replyId)) return Response.json({ error: 'Geçersiz ID.' }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as { text?: string; polish?: boolean }
  const text = body.text?.trim()
  if (!text) return Response.json({ error: 'Yanıt metni boş.' }, { status: 400 })

  const reply = await db.reply.findUnique({
    where: { id: replyId },
    include: { message: { include: { company: true } } },
  })
  if (!reply) return Response.json({ error: 'Yanıt bulunamadı.' }, { status: 404 })

  let finalText = text
  if (body.polish !== false) {
    try {
      finalText = await polishReply({ text, context: reply.bodyText })
    } catch (error) {
      // AI erisilemezse kullanicinin metni oldugu gibi gider — gonderim engellenmez.
      console.error('[answer] polishReply basarisiz:', error)
    }
  }

  const sender = env.sender()
  const signature = [sender.name, sender.title].filter(Boolean).join('\n')
  const full = signature ? `${finalText}\n\n${signature}` : finalText

  const subject = reply.message.subject.startsWith('Re:')
    ? reply.message.subject
    : `Re: ${reply.message.subject}`

  // In-Reply-To okunamazsa gonderimi engelleme; thread'e ekleme zaten threadId
  // ile calisiyor, baslik sadece istemci tarafinda daha duzgun gruplama saglar.
  let inReplyTo: string | null = null
  if (reply.gmailMessageId) {
    try {
      inReplyTo = await getMessageIdHeader(reply.gmailMessageId)
    } catch (error) {
      console.error('[answer] Message-ID okunamadi:', error)
    }
  }

  try {
    const sent = await sendMail({
      to: reply.fromEmail,
      subject,
      text: full,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">${full
        .split('\n')
        .map((line) => line.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!))
        .join('<br>')}</div>`,
      threadId: reply.message.gmailThreadId ?? undefined,
      inReplyTo: inReplyTo ?? undefined,
    })

    await db.reply.update({ where: { id: replyId }, data: { answeredAt: new Date() } })

    return Response.json({
      ok: true,
      to: reply.fromEmail,
      company: reply.message.company.name,
      sentText: finalText,
      gmailMessageId: sent.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Yanıt gönderilemedi.'
    return Response.json({ error: message }, { status: 502 })
  }
}
