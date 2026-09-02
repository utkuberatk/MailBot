#!/usr/bin/env node
/**
 * Cloudflare tuneli.
 *
 *   npm run tunnel
 *
 * Iki kipte calisir:
 *
 *  1. CLOUDFLARE_TUNNEL_NAME tanimliysa KALICI tunel calistirilir
 *     (`cloudflared tunnel run <ad>`). Kendi alan adiniza bagli oldugu icin
 *     adres her seferinde aynidir ve MAIL_TRACKING_URL olarak kullanilabilir.
 *
 *  2. Tanimli degilse gecici bir hizli tunel acilir. Bu adres YALNIZCA
 *     arayuze uzaktan bakmak icindir; mailin icine konamaz. *.trycloudflare.com
 *     alt alan adlari oltalama icin yogun kotuye kullanildigindan, bu adrese
 *     giden link iceren mailler spam'e duser.
 *
 * Bu betik .env dosyasina yazmaz — mail adresi elle ve bilerek verilir.
 */

require('dotenv/config')

const { spawn } = require('node:child_process')
const fs = require('node:fs')

const PORT = Number(process.env.PORT || 3000)
const TUNNEL_NAME = (process.env.CLOUDFLARE_TUNNEL_NAME || '').trim()

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

const binary = findCloudflared()
const args = TUNNEL_NAME
  ? ['tunnel', 'run', TUNNEL_NAME]
  : ['tunnel', '--url', `http://localhost:${PORT}`]

if (TUNNEL_NAME) {
  console.log(`\nKalici tunel calistiriliyor: ${TUNNEL_NAME}`)
  console.log(`  Mail takibi icin .env → MAIL_TRACKING_URL=${process.env.MAIL_TRACKING_URL || '(bos)'}\n`)
} else {
  console.log('\nGecici tunel aciliyor (yalnizca uzaktan arayuz erisimi icin).')
  console.log('⚠  Bu adresi MAIL_TRACKING_URL olarak KULLANMAYIN — mailleriniz spam\'e duser.')
  console.log('   Acilma takibi icin kendi alan adinizi baglayin (README: "Kendi alan adini baglama").\n')
}

const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })

child.on('error', (error) => {
  console.error(
    `\n✖ cloudflared calistirilamadi (${binary}): ${error.message}\n` +
      '  Kurulum: winget install Cloudflare.cloudflared\n' +
      '  Kuruluysa yolunu .env icinde CLOUDFLARED_PATH ile verin.\n',
  )
  process.exit(1)
})

let announced = false

function scan(chunk) {
  const text = chunk.toString()

  if (!announced && !TUNNEL_NAME) {
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
    if (match) {
      announced = true
      console.log(`\n✓ Gecici adres: ${match[0]}`)
      console.log('  (Sadece arayuz icin. Mail takibinde kullanilamaz.)\n')
    }
  }

  if (!announced && TUNNEL_NAME && /Registered tunnel connection|connection established/i.test(text)) {
    announced = true
    console.log('✓ Kalici tunel baglandi.\n')
  }
}

child.stdout.on('data', scan)
child.stderr.on('data', scan) // cloudflared durum satirlarini stderr'e yaziyor

function cleanup() {
  child.kill()
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

child.on('exit', (code) => {
  if (!announced) console.error(`\n✖ cloudflared beklenmedik sekilde kapandi (kod ${code}).\n`)
  process.exit(code ?? 0)
})
