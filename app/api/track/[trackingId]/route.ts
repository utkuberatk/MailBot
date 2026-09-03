import { recordEvent } from '@/lib/tracking'

/** 1x1 seffaf PNG — mail istemcisi gorseli cektiginde acilma kaydedilir. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await params

  // recordEvent kendi icinde hata yutar — piksel her kosulda donmeli.
  await recordEvent({ trackingId, type: 'OPEN', request })

  return new Response(new Uint8Array(PIXEL), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(PIXEL.length),
      // Onbellege alinirsa ikinci acilis gorulmez.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    },
  })
}
