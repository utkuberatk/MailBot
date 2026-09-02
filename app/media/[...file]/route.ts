import fs from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_DIR } from '@/lib/video'

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/** media/ klasorunu servis eder — video onizlemeleri mailden buradan cagrilir. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string[] }> },
) {
  const { file } = await params
  const target = path.join(MEDIA_DIR, ...file.map((part) => path.basename(part)))

  // Klasor disina cikilmasin.
  if (!target.startsWith(MEDIA_DIR)) return new Response('Bulunamadı', { status: 404 })

  try {
    const data = await fs.readFile(target)
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new Response('Bulunamadı', { status: 404 })
  }
}
