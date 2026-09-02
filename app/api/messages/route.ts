import { db } from '@/lib/db'
import { getQuota, startQueue, workerState } from '@/lib/mailer'
import { env } from '@/lib/env'
import type { Prisma } from '@/generated/prisma/client'

/**
 * Gonderilen/kuyruktaki mailler.
 * ?status=SENT|QUEUED|FAILED  ?opened=1|0
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')?.trim()
  const opened = searchParams.get('opened')

  const where: Prisma.MessageWhereInput = {}
  if (status) where.status = status
  if (opened === '1') where.openedAt = { not: null }
  if (opened === '0') where.openedAt = null

  const [messages, counts, quota] = await Promise.all([
    db.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        company: { select: { id: true, name: true, domain: true } },
        campaign: { select: { id: true, name: true } },
        replies: {
          select: { id: true, sentiment: true, summary: true, receivedAt: true },
          orderBy: { receivedAt: 'desc' },
        },
      },
    }),
    db.message.groupBy({ by: ['status'], _count: { _all: true } }),
    getQuota(),
  ])

  const opens = await db.message.count({ where: { openedAt: { not: null } } })

  return Response.json({
    messages,
    stats: {
      byStatus: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
      opened: opens,
    },
    quota,
    worker: workerState(),
    tracking: { enabled: env.trackingEnabled() },
  })
}

/** Kuyrukta bekleyen mailleri yeniden isler (limit dolduysa veya app yeniden basladiysa). */
export async function POST() {
  const pending = await db.message.count({ where: { status: 'QUEUED' } })
  if (pending === 0) return Response.json({ started: false, pending: 0 })

  startQueue()
  return Response.json({ started: true, pending })
}
