/**
 * Video onizleme (thumbnail) uretimi.
 *
 * Kaynak yerel bir video dosyasi ya da YouTube/Vimeo linki olabilir.
 * Kare cikarma ve play butonu bindirme ffmpeg ile yapilir; ffmpeg kurulu
 * degilse uzak videolarin hazir kapak gorseli oldugu gibi kullanilir
 * (bu durumda play butonu olmaz, mail yine calisir).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { deflateSync } from 'node:zlib'
import fs from 'node:fs/promises'
import path from 'node:path'

const run = promisify(execFile)

export const MEDIA_DIR = path.join(process.cwd(), 'media')
/** Tarayiciya /media/... yolundan servis edilir. */
export const MEDIA_URL_PREFIX = '/media'

export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

// --- Minimal RGBA PNG yazici (play butonu icin; harici bagimlilik yok) ------

function crc32(buffer: Buffer): number {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit derinligi
  header[9] = 6 // RGBA
  // 10-12: sikistirma, filtre, interlace = 0

  // Her satirin basina filtre baytini (0) ekle.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Yuvarlak, yari saydam siyah zemin uzerinde beyaz oynat ucgeni. */
export function playButtonPng(size = 160): Buffer {
  const rgba = Buffer.alloc(size * size * 4)
  const center = size / 2
  const radius = size / 2 - 2

  // Ucgen: dairenin icine oturan, saga bakan esKenar ucgen.
  const triHeight = size * 0.42
  const triWidth = size * 0.36
  const left = center - triWidth / 2 + size * 0.03
  const top = center - triHeight / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center)
      // Kenarlarda yumusak gecis (antialias)
      const circle = Math.max(0, Math.min(1, radius - distance + 0.5))
      if (circle <= 0) continue

      // Ucgenin icinde miyiz? Yukseklige gore genisleyen yariciap.
      const ratio = (y + 0.5 - top) / triHeight
      const inTriangle =
        ratio >= 0 &&
        ratio <= 1 &&
        x + 0.5 >= left &&
        x + 0.5 <= left + triWidth * (1 - Math.abs(ratio * 2 - 1))

      if (inTriangle) {
        rgba[index] = 255
        rgba[index + 1] = 255
        rgba[index + 2] = 255
        rgba[index + 3] = Math.round(255 * circle)
      } else {
        rgba[index + 3] = Math.round(150 * circle)
      }
    }
  }

  return encodePng(size, size, rgba)
}

// --- Kaynak coz -------------------------------------------------------------

function youtubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/,
  )
  return match ? match[1] : null
}

async function vimeoThumbnail(url: string): Promise<string | null> {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (!match) return null

  const response = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`)
  if (!response.ok) return null

  const data = (await response.json()) as { thumbnail_url?: string }
  return data.thumbnail_url ?? null
}

/** Uzak videonun hazir kapak gorselini indirir, yerel dosya yolunu doner. */
async function downloadPoster(url: string, target: string): Promise<boolean> {
  const id = youtubeId(url)
  const posterUrl = id ? `https://img.youtube.com/vi/${id}/maxresdefault.jpg` : await vimeoThumbnail(url)
  if (!posterUrl) return false

  let response = await fetch(posterUrl)
  // maxres her videoda yok; hqdefault her zaman var.
  if (!response.ok && id) response = await fetch(`https://img.youtube.com/vi/${id}/hqdefault.jpg`)
  if (!response.ok) return false

  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()))
  return true
}

export type ThumbnailResult = {
  /** Uygulama koku altindaki yol: /media/thumb-...jpg */
  path: string
  /** ffmpeg yoksa play butonu bindirilemez. */
  withPlayButton: boolean
  warning?: string
}

/**
 * Video icin onizleme uretir.
 * `source` yerel dosya adi (media/ altinda) veya YouTube/Vimeo linki olabilir.
 */
export async function generateThumbnail(source: string): Promise<ThumbnailResult> {
  await fs.mkdir(MEDIA_DIR, { recursive: true })

  const stamp = Date.now().toString(36)
  const outputName = `thumb-${stamp}.jpg`
  const outputPath = path.join(MEDIA_DIR, outputName)
  const isRemote = /^https?:\/\//i.test(source)

  const ffmpeg = await hasFfmpeg()
  let frame: string | null = null

  if (isRemote) {
    const poster = path.join(MEDIA_DIR, `poster-${stamp}.jpg`)
    const ok = await downloadPoster(source, poster)
    if (!ok) {
      throw new Error(
        'Bu bağlantıdan kapak görseli alınamadı. YouTube/Vimeo linki verin ya da ' +
          'videoyu media/ klasörüne koyup dosya adını yazın.',
      )
    }
    frame = poster
  } else {
    const videoPath = path.join(MEDIA_DIR, path.basename(source))
    try {
      await fs.access(videoPath)
    } catch {
      throw new Error(`media/ klasöründe böyle bir dosya yok: ${path.basename(source)}`)
    }

    if (!ffmpeg) {
      throw new Error(
        'Yerel videodan kare çıkarmak için ffmpeg gerekli. Kurulum: winget install Gyan.FFmpeg',
      )
    }

    frame = path.join(MEDIA_DIR, `frame-${stamp}.jpg`)
    // Videonun 3. saniyesinden tek kare al, en fazla 960px genislige olcekle.
    await run('ffmpeg', [
      '-y', '-ss', '3', '-i', videoPath,
      '-frames:v', '1',
      '-vf', "scale='min(960,iw)':-2",
      frame,
    ])
  }

  if (!ffmpeg) {
    // Play butonu bindirilemedi; kapak gorselini oldugu gibi kullan.
    await fs.rename(frame, outputPath)
    return {
      path: `${MEDIA_URL_PREFIX}/${outputName}`,
      withPlayButton: false,
      warning:
        'ffmpeg kurulu olmadığı için üzerine oynat butonu eklenemedi. ' +
        'Kurulum: winget install Gyan.FFmpeg',
    }
  }

  const buttonPath = path.join(MEDIA_DIR, `.play-${stamp}.png`)
  await fs.writeFile(buttonPath, playButtonPng(160))

  // Kapak + ortalanmis play butonu.
  await run('ffmpeg', [
    '-y', '-i', frame, '-i', buttonPath,
    '-filter_complex', '[0:v]scale=\'min(960,iw)\':-2[bg];[bg][1:v]overlay=(W-w)/2:(H-h)/2',
    '-frames:v', '1', '-q:v', '3',
    outputPath,
  ])

  await Promise.all([
    fs.unlink(buttonPath).catch(() => {}),
    fs.unlink(frame).catch(() => {}),
  ])

  return { path: `${MEDIA_URL_PREFIX}/${outputName}`, withPlayButton: true }
}
