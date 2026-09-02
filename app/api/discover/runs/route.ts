import { db } from '@/lib/db'

/** Son kesif calistirmalarini doner (UI listesi ve durum takibi icin). */
export async function GET(request: Request) {
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
