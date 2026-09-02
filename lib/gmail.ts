/**
 * Gmail API istemcisi.
 *
 * Refresh token ile access token alir (bellekte onbellege alinir), MIME mesaji
 * kurar ve gonderir. Yanit senkronizasyonu icin thread/message okuma da burada.
 */

import { env } from '@/lib/env'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

let cachedToken: { value: string; expiresAt: number } | null = null

/** Gecerli access token — suresi dolmadan 60 sn once yenilenir. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.gmailClientId(),
      client_secret: env.gmailClientSecret(),
      refresh_token: env.gmailRefreshToken(),
      grant_type: 'refresh_token',
    }),
  })

  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
    error_description?: string
    error?: string
  }

  if (!response.ok || !data.access_token) {
    throw new Error(
      `Gmail yetkilendirme basarisiz: ${data.error_description ?? data.error ?? response.status}. ` +
        'npm run gmail:auth ile token yenileyin.',
    )
  }

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return cachedToken.value
}

async function gmailFetch(path: string, init?: RequestInit) {
  const token = await getAccessToken()
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (data as { error?: { message?: string } }).error?.message ?? response.statusText
    throw new Error(`Gmail API hatasi (${response.status}): ${message}`)
  }
  return data
}

/** RFC 2047 — basliklardaki Turkce karakterler icin. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function encodeAddress(name: string, email: string): string {
  return name ? `${encodeHeader(name)} <${email}>` : email
}

/** Gmail API base64url bekler. */
function toBase64Url(input: string | Buffer): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(input: string): string {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

export type OutgoingMail = {
  to: string
  subject: string
  html: string
  text: string
  /** Yanit gonderirken: yanitlanacak mesajin Message-ID basligi. */
  inReplyTo?: string
  threadId?: string
  /** Hazir `List-Unsubscribe` baslik degeri (`<mailto:...>` veya `<https://...>`). */
  listUnsubscribe?: string
  /** One-Click yalnizca https uc ile anlamli; mailto bicimde gonderilmez. */
  listUnsubscribeOneClick?: boolean
}

/** text/plain + text/html alternatifi iceren MIME mesaji kurar. */
export function buildMime(mail: OutgoingMail): string {
  const sender = env.sender()
  const boundary = `mb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

  const headers = [
    `From: ${encodeAddress(sender.name, env.gmailUser())}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]

  if (mail.inReplyTo) {
    headers.push(`In-Reply-To: ${mail.inReplyTo}`, `References: ${mail.inReplyTo}`)
  }

  // Spam filtreleri icin: cikis yolu. Gmail bu basligi arayuzde gosterir.
  if (mail.listUnsubscribe) {
    headers.push(`List-Unsubscribe: ${mail.listUnsubscribe}`)
    if (mail.listUnsubscribeOneClick) {
      headers.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click')
    }
  }

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(mail.text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\n'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(mail.html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\n'),
    `--${boundary}--`,
    '',
  ]

  return [...headers, '', ...body].join('\r\n')
}

export type SentMail = { id: string; threadId: string }

/** Mail gonderir, Gmail mesaj ve thread ID'sini doner. */
export async function sendMail(mail: OutgoingMail): Promise<SentMail> {
  const payload: { raw: string; threadId?: string } = { raw: toBase64Url(buildMime(mail)) }
  if (mail.threadId) payload.threadId = mail.threadId

  const data = (await gmailFetch('/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })) as { id: string; threadId: string }

  return { id: data.id, threadId: data.threadId }
}

type GmailPart = {
  mimeType?: string
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}

type GmailMessage = {
  id: string
  threadId: string
  internalDate?: string
  payload?: GmailPart & { headers?: { name: string; value: string }[] }
  snippet?: string
}

/** Coklu parcali govdeden duz metni cikarir (html varsa etiketleri temizler). */
function extractText(part?: GmailPart): string {
  if (!part) return ''

  if (part.mimeType === 'text/plain' && part.body?.data) return fromBase64Url(part.body.data)

  if (part.parts) {
    for (const child of part.parts) {
      const text = extractText(child)
      if (text) return text
    }
  }

  if (part.mimeType === 'text/html' && part.body?.data) {
    return fromBase64Url(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }

  return ''
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

export type ThreadReply = {
  messageId: string
  threadId: string
  from: string
  fromEmail: string
  subject: string
  text: string
  receivedAt: Date
  messageIdHeader: string | null
}

function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return found?.value ?? ''
}

function emailOf(address: string): string {
  const match = address.match(/<([^>]+)>/)
  return (match ? match[1] : address).trim().toLowerCase()
}

/**
 * Bir thread'deki bize gelen yanitlari doner (kendi gonderdiklerimiz haric).
 */
export async function getThreadReplies(threadId: string): Promise<ThreadReply[]> {
  const thread = (await gmailFetch(`/threads/${threadId}?format=full`)) as {
    messages?: GmailMessage[]
  }
  const own = env.gmailUser().toLowerCase()

  return (thread.messages ?? [])
    .filter((message) => emailOf(header(message, 'From')) !== own)
    .map((message) => {
      const from = header(message, 'From')
      return {
        messageId: message.id,
        threadId: message.threadId,
        from,
        fromEmail: emailOf(from),
        subject: header(message, 'Subject'),
        text: stripQuotedText(extractText(message.payload) || message.snippet || ''),
        receivedAt: new Date(Number(message.internalDate ?? Date.now())),
        messageIdHeader: header(message, 'Message-ID') || null,
      }
    })
}

/** Gonderilen mesajin Message-ID basligi — yanit verirken In-Reply-To icin gerekir. */
export async function getMessageIdHeader(messageId: string): Promise<string | null> {
  const message = (await gmailFetch(
    `/messages/${messageId}?format=metadata&metadataHeaders=Message-ID`,
  )) as GmailMessage
  return header(message, 'Message-ID') || null
}

/** Yetkilendirmenin calistigini dogrular; hesap adresini doner. */
export async function verifyAccess(): Promise<string> {
  const profile = (await gmailFetch('/profile')) as { emailAddress: string }
  return profile.emailAddress
}
