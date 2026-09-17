import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMime,
  deduplicateIncomingMessages,
  parseIncomingMessage,
  type IncomingMail,
} from '@/lib/email'
import { findReferencedMessageId, isOptOutRequest } from '@/lib/inbox'

process.env.SENDER_NAME = 'Utku Berat'
process.env.SENDER_ADDRESS = 'sales@getsylva.net'

const rootMessageId = '<root-1@getsylva.net>'
const replyMessageId = '<reply-1@example.com>'

test('personal MIME stays single-part text/plain with an RFC Message-ID', () => {
  const mime = buildMime({
    to: 'hello@example.com',
    subject: 'Kısa konu',
    text: 'Merhaba',
    messageId: rootMessageId,
    date: new Date('2026-09-17T10:00:00.000Z'),
  })

  assert.match(mime, /From: Utku Berat <sales@getsylva\.net>/)
  assert.match(mime, /Message-ID: <root-1@getsylva\.net>/)
  assert.match(mime, /Content-Type: text\/plain; charset="UTF-8"/)
  assert.doesNotMatch(mime, /multipart\/alternative/)
  assert.doesNotMatch(mime, /^DKIM-Signature:/m)
})

test('tracked MIME preserves multipart HTML and unsubscribe headers', () => {
  const mime = buildMime({
    to: 'hello@example.com',
    subject: 'Konu',
    text: 'Düz metin',
    html: '<p>HTML</p>',
    messageId: rootMessageId,
    listUnsubscribe: '<https://mail.getsylva.net/api/unsubscribe/abc>',
    listUnsubscribeOneClick: true,
  })

  assert.match(mime, /Content-Type: multipart\/alternative/)
  assert.match(mime, /Content-Type: text\/plain; charset="UTF-8"/)
  assert.match(mime, /Content-Type: text\/html; charset="UTF-8"/)
  assert.match(mime, /List-Unsubscribe: <https:\/\/mail\.getsylva\.net\/api\/unsubscribe\/abc>/)
  assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/)
})

test('reply MIME includes In-Reply-To and the complete References chain', () => {
  const mime = buildMime({
    to: 'hello@example.com',
    subject: 'Re: Konu',
    text: 'Yanıt',
    messageId: '<answer-1@getsylva.net>',
    inReplyTo: replyMessageId,
    references: [rootMessageId],
  })

  assert.match(mime, /In-Reply-To: <reply-1@example\.com>/)
  assert.match(
    mime,
    /References: <root-1@getsylva\.net> <reply-1@example\.com>/,
  )
})

test('IMAP MIME parsing keeps RFC threading data and strips quoted content', async () => {
  const raw = Buffer.from(
    [
      'From: Example <hello@example.com>',
      'To: sales@getsylva.net',
      'Subject: Re: Konu',
      `Message-ID: ${replyMessageId}`,
      `In-Reply-To: ${rootMessageId}`,
      `References: ${rootMessageId}`,
      'Date: Thu, 17 Sep 2026 10:05:00 +0300',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Olumlu, görüşebiliriz.',
      '',
      '> Önceki mesaj',
    ].join('\r\n'),
  )

  const parsed = await parseIncomingMessage(raw, {
    account: 'sales@getsylva.net',
    mailbox: 'INBOX',
    uidValidity: '42',
    uid: 7,
  })

  assert.equal(parsed.imapKey, 'imap:sales@getsylva.net:INBOX:42:7')
  assert.equal(parsed.fromEmail, 'hello@example.com')
  assert.equal(parsed.rfcMessageId, replyMessageId)
  assert.equal(parsed.inReplyTo, rootMessageId)
  assert.deepEqual(parsed.references, [rootMessageId])
  assert.equal(parsed.text, 'Olumlu, görüşebiliriz.')
})

test('RFC references match an incoming reply to the sent Message row', () => {
  const incoming: IncomingMail = {
    imapKey: 'imap:sales@getsylva.net:INBOX:42:7',
    fromEmail: 'hello@example.com',
    subject: 'Re: Konu',
    text: 'Yanıt',
    receivedAt: new Date(),
    rfcMessageId: replyMessageId,
    inReplyTo: rootMessageId,
    references: [rootMessageId],
  }

  assert.equal(findReferencedMessageId(incoming, new Map([[rootMessageId, 123]])), 123)
})

test('the same IMAP message is not returned on a second synchronization', () => {
  const incoming: IncomingMail = {
    imapKey: 'imap:sales@getsylva.net:INBOX:42:7',
    fromEmail: 'hello@example.com',
    subject: 'Re: Konu',
    text: 'Yanıt',
    receivedAt: new Date(),
    rfcMessageId: replyMessageId,
    inReplyTo: rootMessageId,
    references: [rootMessageId],
  }

  assert.equal(deduplicateIncomingMessages([incoming, incoming]).length, 1)
  assert.equal(
    deduplicateIncomingMessages([incoming], [replyMessageId], [incoming.imapKey]).length,
    0,
  )
})

test('opt-out detection keeps personal-mode rejection phrases active', () => {
  assert.equal(isOptOutRequest('İlgilenmiyorum, bir daha e-posta göndermeyin.'), true)
  assert.equal(isOptOutRequest('Yarın saat 15:00 uygundur.'), false)
})
