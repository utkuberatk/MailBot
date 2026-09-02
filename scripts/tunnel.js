#!/usr/bin/env node
/**
 * Cloudflare hizli tuneli.
 *
 *   npm run tunnel
 *
 * Uygulamayi disariya acar ve olusan adresi .env'deki PUBLIC_URL alanina yazar.
 * Takip pikseli, video onizlemesi ve listeden cikis linki mailin icinden bu
 * adres uzerinden cagrilir; tunel olmadan alicinin mail istemcisi localhost'a
 * ulasamaz ve hicbir mail "acildi" gorunmez.
 *
 * Pencere kapatilinca adres gecersiz olur ve PUBLIC_URL temizlenir.
 * Hesap gerektirmez, ucretsizdir; adres her calistirmada degisir.
 */

require('dotenv/config')

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ENV_PATH = path.resolve(__dirname, '..', '.env')
const PORT = Number(process.env.PORT || 3000)

/** winget ile kurulunca PATH'e her zaman eklenmiyor. */
const CANDIDATES = [
  process.env.CLOUDFLARED_PATH,
  'cloudflared',
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
].filter(Boolean)

function findCloudflared() {
  for (const candidate of CANDIDATES) {
    if (candidate === 'cloudflared') return candidate
    if (fs.existsSync(candidate)) return candidate
  }
  return 'cloudflared'
}

/** .env icindeki bir anahtari gunceller, yoksa sonuna ekler. */
function writeEnv(key, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf8')
  const line = `${key}="${value}"`
  const pattern = new RegExp(`^${key}=.*$`, 'm')

  content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`
  fs.writeFileSync(ENV_PATH, content, 'utf8')
}

const binary = findCloudflared()
const child = spawn(binary, ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.on('error', (error) => {
  console.error(
    `\n✖ cloudflared calistirilamadi (${binary}): ${error.message}\n` +
      '  Kurulum: winget install Cloudflare.cloudflared\n' +
      '  Kuruluysa yolunu .env icinde CLOUDFLARED_PATH ile verin.\n',
  )
  process.exit(1)
})

let found = false

function scan(chunk) {
  const text = chunk.toString()
  if (found) return

  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
  if (!match) return

  found = true
  const url = match[0]
  writeEnv('PUBLIC_URL', url)

  console.log('\n✓ Tunel acildi.')
  console.log(`  Genel adres : ${url}`)
  console.log('  .env guncel : PUBLIC_URL')
  console.log('\n  Bu pencere acik kaldigi surece acilma takibi ve mail gorselleri calisir.')
  console.log('  Kapatirsaniz adres gecersiz olur.\n')
}

child.stdout.on('data', scan)
child.stderr.on('data', scan) // cloudflared adresi stderr'e yaziyor

function cleanup() {
  if (found) writeEnv('PUBLIC_URL', '')
  child.kill()
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

child.on('exit', (code) => {
  if (found) writeEnv('PUBLIC_URL', '')
  if (!found) console.error(`\n✖ cloudflared beklenmedik sekilde kapandi (kod ${code}).\n`)
  process.exit(code ?? 0)
})
