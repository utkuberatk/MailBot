/**
 * Saglayicidan bagimsiz e-posta katmani.
 *
 * Gonderim RFC 5322 mesaji olarak uretilip SMTP ile iletilir. Gelen kutusu
 * IMAP uzerinden salt okunur taranir ve ham MIME PostalMime ile ayrisir.
 * TLS sertifika dogrulamasi her iki baglantida da aciktir.
 */

import { randomUUID } from 'node:crypto'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import PostalMime, { type Address } from 'postal-mime'
import { env } from '@/lib/env'

export type OutgoingMail = {
  to: string
  subject: string
  /** HTML yoksa mesaj tek parca text/plain uretilir. */
  html?: string
  text: string
  /** Yanitlanan iletinin RFC Message-ID degeri. */
  inReplyTo?: string
  /** Kokten ebeveyne kadar RFC Message-ID zinciri. */
  references?: string[]
  /** Testler ve yeniden denemeler icin onceden belirlenebilir. */
  messageId?: string
  date?: Date
  /** Hazir List-Unsubscribe baslik degeri. */
  listUnsubscribe?: string
  /** One-Click yalnizca https uc ile anlamlidir. */
  listUnsubscribeOneClick?: boolean
}

export type SentMail = {
  /** SMTP sunucusuna verilen ve veritabaninda saklanan RFC Message-ID. */
  messageId: string
  response: string
}

export type IncomingMail = {
  imapKey: string
  fromEmail: string
  subject: string
  text: string
  receivedAt: Date
  rfcMessageId: string | null
  inReplyTo: string | null
  references: string[]
}

export type IncomingMessageMeta = {
  account: string
  mailbox: string
  uidValidity: string
  uid: number
  internalDate?: Date | string
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/** RFC 2047 — basliklardaki Turkce karakterler icin. */
function encodeHeader(value: string): string {
  const safe = safeHeader(value)
  if (Buffer.byteLength(safe, 'utf8') === safe.length) return safe
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`
}

function encodeAddress(name: string, email: string): string {
  const safeEmail = safeHeader(email)
  return name ? `${encodeHeader(name)} <${safeEmail}>` : safeEmail
}

const base64Body = (value: string) =>
  Buffer.from(value, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')

/** Message-ID degerini tek ve karsilastirilabilir `<local@domain>` bicimine getirir. */
export function normalizeMessageId(value?: string | null): string | null {
  if (!value) return null
  const safe = safeHeader(value)
  const bracketed = safe.match(/<([^<>\s]+@[^<>\s]+)>/)
  if (bracketed) return `<${bracketed[1].toLowerCase()}>`

  const bare = safe.match(/([^<>\s]+@[^<>\s]+)/)
  return bare ? `<${bare[1].toLowerCase()}>` : null
}

/** References gibi birden cok Message-ID iceren basliklari sirali olarak ayirir. */
export function extractMessageIds(value?: string | null): string[] {
  if (!value) return []
  const matches = value.match(/<[^<>\s]+@[^<>\s]+>|[^<>\s,;]+@[^<>\s,;]+/g) ?? []
  const seen = new Set<string>()
  const result: string[] = []

  for (const match of matches) {
    const normalized = normalizeMessageId(match)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }

  return result
}

/** Bir yanitin once ebeveynini, sonra daha eski atalarini eslestirmede kullanir. */
export function incomingReferenceIds(message: IncomingMail): string[] {
  const ordered = [message.inReplyTo, ...message.references.toReversed()]
  return [...new Set(ordered.filter((value): value is string => Boolean(value)))]
}

/** Ayni IMAP iletisini ayni veya sonraki senkronizasyonda bir kez birakir. */
export function deduplicateIncomingMessages(
  messages: IncomingMail[],
  existingRfcMessageIds: Iterable<string> = [],
  existingImapKeys: Iterable<string> = [],
): IncomingMail[] {
  const seenRfc = new Set([...existingRfcMessageIds].map((value) => normalizeMessageId(value) ?? value))
  const seenImap = new Set(existingImapKeys)
  const result: IncomingMail[] = []

  for (const message of messages) {
    const rfcMessageId = normalizeMessageId(message.rfcMessageId)
    if (seenImap.has(message.imapKey) || (rfcMessageId && seenRfc.has(rfcMessageId))) continue

    seenImap.add(message.imapKey)
    if (rfcMessageId) seenRfc.add(rfcMessageId)
    result.push({ ...message, rfcMessageId })
  }

  return result
}

function createMessageId(senderAddress: string): string {
  const domain = senderAddress.split('@')[1]?.toLowerCase() || 'localhost'
  return `<${randomUUID()}@${domain}>`
}

/**
 * Mevcut text/plain ve multipart/alternative MIME bicimini korur.
 * SMTP saglayicisi SPF/DKIM'i kendisi uygular; uygulama DKIM basligi eklemez.
 */
export function buildMime(mail: OutgoingMail): string {
  const sender = env.sender()
  const messageId = normalizeMessageId(mail.messageId) ?? createMessageId(sender.address)
  const inReplyTo = normalizeMessageId(mail.inReplyTo)
  const references = extractMessageIds(mail.references?.join(' '))
  if (inReplyTo && !references.includes(inReplyTo)) references.push(inReplyTo)

  const headers = [
    `From: ${encodeAddress(sender.name, sender.address)}`,
    `To: ${safeHeader(mail.to)}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${(mail.date ?? new Date()).toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ]

  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`)
  if (references.length > 0) headers.push(`References: ${references.join(' ')}`)

  if (mail.listUnsubscribe) {
    headers.push(`List-Unsubscribe: ${safeHeader(mail.listUnsubscribe)}`)
    if (mail.listUnsubscribeOneClick) {
      headers.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click')
    }
  }

  if (!mail.html) {
    headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64')
    return [...headers, '', base64Body(mail.text), ''].join('\r\n')
  }

  const boundary = `mb_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 10)}`
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(mail.html),
    `--${boundary}--`,
    '',
  ]

  return [...headers, '', ...body].join('\r\n')
}

let smtpTransporter: ReturnType<typeof nodemailer.createTransport> | null = null

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter
  const config = env.smtp()
  smtpTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    tls: {
      rejectUnauthorized: true,
      servername: config.host,
    },
  })
  return smtpTransporter
}

/** Ham RFC mesaji SMTP ile tek aliciya gonderir. */
export async function sendMail(mail: OutgoingMail): Promise<SentMail> {
  const smtp = env.smtp()
  const sender = env.sender()
  if (smtp.user.trim().toLowerCase() !== sender.address.trim().toLowerCase()) {
    throw new Error('SENDER_ADDRESS, SMTP_USER ile ayni olmalidir.')
  }

  const messageId = normalizeMessageId(mail.messageId) ?? createMessageId(sender.address)
  const info = await getSmtpTransporter().sendMail({
    envelope: { from: smtp.user, to: mail.to },
    raw: Buffer.from(buildMime({ ...mail, messageId }), 'utf8'),
  })

  if (info.rejected.length > 0 || info.accepted.length === 0) {
    throw new Error(`SMTP aliciyi reddetti: ${info.response}`)
  }

  return { messageId, response: info.response }
}

/** Alintilanan onceki mail govdesini atar — analiz sadece yeni metne baksin. */
export function stripQuotedText(text: string): string {
  const lines = text.split('\n')
  const cut = lines.findIndex(
    (line) =>
      /^>/.test(line.trim()) ||
      /^-{2,}\s*(Forwarded|Original)/i.test(line.trim()) ||
      /\d{1,2}\s+\w+\s+\d{4}.*(yazd[ıi]|wrote):\s*$/i.test(line.trim()) ||
      /^On .+wrote:$/i.test(line.trim()),
  )
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim()
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function addressEmail(address?: Address): string {
  if (!address) return ''
  if ('group' in address && address.group) return address.group[0]?.address?.toLowerCase() ?? ''
  return address.address?.toLowerCase() ?? ''
}

function validDate(value?: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  return Number.isNaN(date.getTime()) ? new Date() : date
}

/** Ham IMAP iletisini MailBot'un saglayicidan bagimsiz gelen mesaj bicimine cevirir. */
export async function parseIncomingMessage(
  source: Buffer,
  meta: IncomingMessageMeta,
): Promise<IncomingMail> {
  const parsed = await PostalMime.parse(source, {
    maxHeadersSize: 256 * 1024,
    maxNestingDepth: 64,
    maxRfc822NestingDepth: 5,
  })

  const rfcMessageId = normalizeMessageId(parsed.messageId)
  const inReplyTo = normalizeMessageId(parsed.inReplyTo)
  const references = extractMessageIds(parsed.references)
  const receivedAt = validDate(parsed.date ?? meta.internalDate)
  const text = stripQuotedText(parsed.text || htmlToText(parsed.html ?? ''))
  const account = meta.account.trim().toLowerCase()

  return {
    imapKey: `imap:${account}:${meta.mailbox}:${meta.uidValidity}:${meta.uid}`,
    fromEmail: addressEmail(parsed.from),
    subject: parsed.subject?.trim() ?? '',
    text,
    receivedAt,
    rfcMessageId,
    inReplyTo,
    references,
  }
}

/** Son tarihten itibaren INBOX'u salt okunur tarar; Seen bayragini degistirmez. */
export async function fetchIncomingMessages(since: Date): Promise<IncomingMail[]> {
  const config = env.imap()
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    tls: {
      rejectUnauthorized: true,
      servername: config.host,
    },
    logger: false,
    disableAutoIdle: true,
  })
  // EventEmitter'da dinleyicisiz error sureci dusurur. Komut hatalari yine await'e yansir.
  client.on('error', () => undefined)

  await client.connect()
  let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null

  try {
    lock = await client.getMailboxLock('INBOX', {
      readOnly: true,
      description: 'MailBot inbox sync',
      acquireTimeout: 30_000,
    })
    const mailbox = client.mailbox
    if (!mailbox) return []

    const searchResult = await client.search({ since }, { uid: true })
    const uids = Array.isArray(searchResult) ? searchResult : []
    const messages: IncomingMail[] = []

    for (let offset = 0; offset < uids.length; offset += 100) {
      const batch = uids.slice(offset, offset + 100)
      if (batch.length === 0) continue

      for await (const item of client.fetch(
        batch.join(','),
        { uid: true, source: true, internalDate: true },
        { uid: true },
      )) {
        if (!item.source) continue
        messages.push(
          await parseIncomingMessage(item.source, {
            account: config.user,
            mailbox: mailbox.path,
            uidValidity: mailbox.uidValidity.toString(),
            uid: item.uid,
            internalDate: item.internalDate,
          }),
        )
      }
    }

    return messages
  } finally {
    lock?.release()
    await client.logout().catch(() => client.close())
  }
}
