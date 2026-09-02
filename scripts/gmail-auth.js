#!/usr/bin/env node
/**
 * Gmail OAuth2 yetkilendirme.
 *
 *   npm run gmail:auth
 *
 * Tarayicida Google onay ekranini acar, donen kodu refresh token'a cevirir
 * ve .env dosyasindaki GMAIL_REFRESH_TOKEN alanina yazar.
 *
 * Onkosul: .env icinde GMAIL_CLIENT_ID ve GMAIL_CLIENT_SECRET dolu olmali.
 * (Google Cloud Console → Credentials → OAuth client ID → Desktop app)
 */

require('dotenv/config')

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { exec } = require('node:child_process')

const PORT = 53682
const REDIRECT_URI = `http://localhost:${PORT}`
const ENV_PATH = path.resolve(__dirname, '..', '.env')

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ')

const CLIENT_ID = process.env.GMAIL_CLIENT_ID
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  fail(
    'GMAIL_CLIENT_ID ve GMAIL_CLIENT_SECRET tanimli degil.\n\n' +
      '  1. https://console.cloud.google.com adresinde bir proje olusturun\n' +
      '  2. "Gmail API"yi etkinlestirin\n' +
      '  3. OAuth consent screen → External → kendi Gmail adresinizi Test user olarak ekleyin\n' +
      '  4. Credentials → Create credentials → OAuth client ID → Desktop app\n' +
      '  5. Client ID ve Client secret degerlerini .env dosyasina yazin',
  )
}

/** .env icindeki bir anahtari gunceller, yoksa sonuna ekler. */
function writeEnv(key, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf8')
  const line = `${key}="${value}"`
  const pattern = new RegExp(`^${key}=.*$`, 'm')

  content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`
  fs.writeFileSync(ENV_PATH, content, 'utf8')
}

async function exchangeCode(code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error_description || JSON.stringify(data))
  return data
}

/** Token ile hesap adresini ogrenir. */
async function fetchProfile(accessToken) {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) return null
  const data = await response.json()
  return data.emailAddress || null
}

function page(title, message) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f7f7f8;color:#18181b">
<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2>
<p style="color:#71717a;margin:0">${message}</p></div></body>`
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  })

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, REDIRECT_URI)
  if (url.pathname !== '/') {
    response.writeHead(404).end()
    return
  }

  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')

  if (error) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(page('Yetkilendirme iptal edildi', error))
    console.error(`\n✖ Yetkilendirme reddedildi: ${error}\n`)
    server.close()
    process.exit(1)
  }

  if (!code) {
    response.writeHead(400).end()
    return
  }

  try {
    const tokens = await exchangeCode(code)

    if (!tokens.refresh_token) {
      throw new Error(
        'Google refresh token dondurmedi. Google Hesap → Guvenlik → Ucuncu taraf uygulamalar ' +
          'bolumunden MailBot erisimini kaldirip komutu tekrar calistirin.',
      )
    }

    const address = await fetchProfile(tokens.access_token)

    writeEnv('GMAIL_REFRESH_TOKEN', tokens.refresh_token)
    if (address) writeEnv('GMAIL_USER', address)

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(page('Yetkilendirme tamamlandı', 'Bu sekmeyi kapatabilirsiniz.'))

    console.log('\n✓ Yetkilendirme tamamlandi.')
    console.log(`  Hesap        : ${address ?? 'bilinmiyor'}`)
    console.log('  .env guncel  : GMAIL_REFRESH_TOKEN' + (address ? ', GMAIL_USER' : ''))
    console.log('\nUygulamayi yeniden baslatin: npm run dev\n')
  } catch (err) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(page('Hata', err.message))
    console.error(`\n✖ ${err.message}\n`)
    server.close()
    process.exit(1)
  }

  server.close()
  process.exit(0)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('\nGoogle onay sayfasi aciliyor...')
  console.log('Tarayici acilmazsa su adresi elle acin:\n')
  console.log(`  ${authUrl}\n`)
  exec(`start "" "${authUrl}"`, { shell: 'cmd.exe' }, () => {})
})
