import { db } from '@/lib/db'

/** 1x1 seffaf PNG — mail istemcisi gorseli cektiginde acilma kaydedilir. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await params

  // Kayit yoksa veya DB hatasi olursa yine de piksel donmeli — mail bozulmasin.
  try {
    const message = await db.message.findUnique({
      where: { trackingId },
      select: { id: true, openedAt: true },
    })

    if (message) {
      await db.message.update({
        where: { id: message.id },
        data: {
          openedAt: message.openedAt ?? new Date(),
          openCount: { increment: 1 },
        },
      })
    }
  } catch (error) {
    console.error('[track] kayit yazilamadi:', error)
  }

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
