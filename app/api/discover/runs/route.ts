import { db } from '@/lib/db'

/** n8n hata verip bitirme cagrisini yapmazsa kayit sonsuza kadar RUNNING kalmasin. */
const STALE_AFTER_MS = 10 * 60 * 1000

async function expireStaleRuns() {
  await db.discoveryRun.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    data: {
      status: 'FAILED',
      error:
        'Zaman aşımı: n8n workflow 10 dakika içinde sonuç göndermedi. ' +
        'SearXNG (localhost:8080) çalışıyor mu ve n8n çalıştırma günlüğünde hata var mı bakın.',
      finishedAt: new Date(),
    },
  })
}

/** Son kesif calistirmalarini doner (UI listesi ve durum takibi icin). */
export async function GET(request: Request) {
  await expireStaleRuns()

  const { searchParams } = new URL(request.url)
  const runId = Number(searchParams.get('runId'))

  if (Number.isFinite(runId) && runId > 0) {
    const run = await db.discoveryRun.findUnique({
      where: { id: runId },
      include: {
        companies: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            domain: true,
            website: true,
            email: true,
            phone: true,
            city: true,
            sector: true,
          },
        },
      },
    })

    if (!run) return Response.json({ error: 'Kayıt bulunamadı.' }, { status: 404 })
    return Response.json(run)
  }

  const runs = await db.discoveryRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 10,
  })
  return Response.json({ runs })
}
