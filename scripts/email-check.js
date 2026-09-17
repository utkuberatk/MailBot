#!/usr/bin/env node
/**
 * SMTP ve IMAP baglanti/kimlik dogrulama kontrolu.
 *
 * Mail gondermez, mailbox acmaz, mesaj bayraklarini degistirmez. Parola ve
 * diger kimlik bilgilerini loglamaz.
 */

require('dotenv/config')

const nodemailer = require('nodemailer')
const { ImapFlow } = require('imapflow')

function required(key) {
  const value = process.env[key]
  if (!value || !value.trim()) throw new Error(`Eksik ortam degiskeni: ${key}`)
  return value.trim()
}

function port(key) {
  const value = Number(required(key))
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Gecersiz port: ${key}`)
  }
  return value
}

function secure(key) {
  const value = required(key).toLowerCase()
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new Error(`Gecersiz boolean: ${key}`)
}

async function main() {
  const smtp = {
    host: required('SMTP_HOST'),
    port: port('SMTP_PORT'),
    secure: secure('SMTP_SECURE'),
    user: required('SMTP_USER'),
    password: required('SMTP_PASSWORD'),
  }
  const imap = {
    host: required('IMAP_HOST'),
    port: port('IMAP_PORT'),
    secure: secure('IMAP_SECURE'),
    user: required('IMAP_USER'),
    password: required('IMAP_PASSWORD'),
  }
  const senderAddress = required('SENDER_ADDRESS').toLowerCase()
  if (senderAddress !== smtp.user.toLowerCase()) {
    throw new Error('SENDER_ADDRESS, SMTP_USER ile ayni olmalidir.')
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
    tls: { rejectUnauthorized: true, servername: smtp.host },
  })
  await transporter.verify()
  transporter.close()
  console.log('SMTP baglantisi ve kimlik dogrulama basarili. Mail gonderilmedi.')

  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: { user: imap.user, pass: imap.password },
    tls: { rejectUnauthorized: true, servername: imap.host },
    logger: false,
    disableAutoIdle: true,
    verifyOnly: true,
  })
  client.on('error', () => undefined)

  try {
    await client.connect()
    console.log('IMAP baglantisi ve kimlik dogrulama basarili. Posta kutusu degistirilmedi.')
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(`E-posta baglanti kontrolu basarisiz: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
