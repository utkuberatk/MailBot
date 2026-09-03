import { db } from '@/lib/db'
import { getQuota, startQueue, workerState } from '@/lib/mailer'
import { env } from '@/lib/env'
import { deviceLabel } from '@/lib/tracking'
import type { Prisma } from '@/generated/prisma/client'

/**
 * Gonderilen/kuyruktaki mailler.
 * ?status=SENT|QUEUED|FAILED  ?opened=1|0  ?clicked=1
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')?.trim()
  const opened = searchParams.get('opened')
  const clicked = searchParams.get('clicked')

  const where: Prisma.MessageWhereInput = {}
  if (status) where.status = status
  if (opened === '1') where.openedAt = { not: null }
  if (opened === '0') where.openedAt = null
  if (clicked === '1') where.clickCount = { gt: 0 }

  const [messages, counts, quota] = await Promise.all([
    db.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        company: { select: { id: true, name: true, domain: true } },
        campaign: { select: { id: true, name: true } },
        replies: {
          where: { deletedAt: null },
          select: { id: true, sentiment: true, summary: true, receivedAt: true },
          orderBy: { receivedAt: 'desc' },
        },
        // Acilma/tiklama gecmisi — satir genisletilince gosterilir.
        // Sahte acilmalar (isBot) listeye girmez.
        events: {
          where: { isBot: false },
          select: { id: true, type: true, at: true, userAgent: true, target: true },
          orderBy: { at: 'desc' },
          take: 12,
        },
      },
    }),
    db.message.groupBy({ by: ['status'], _count: { _all: true } }),
    getQuota(),
  ])

  const [opens, clicks] = await Promise.all([
    db.message.count({ where: { openedAt: { not: null } } }),
    db.message.count({ where: { clickCount: { gt: 0 } } }),
  ])

  return Response.json({
    // Ham user-agent yerine kisa cihaz etiketi gonderilir.
    messages: messages.map((message) => ({
      ...message,
      events: message.events.map((event) => ({
        id: event.id,
        type: event.type,
        at: event.at,
        target: event.target,
        device: deviceLabel(event.userAgent),
      })),
    })),
    stats: {
      byStatus: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
      opened: opens,
      clicked: clicks,
    },
    quota,
    worker: workerState(),
    tracking: {
      enabled: env.trackingEnabled(),
      devMode: env.trackingDevMode(),
      style: env.mailStyle(),
    },
  })
}

/** Kuyrukta bekleyen mailleri yeniden isler (limit dolduysa veya app yeniden basladiysa). */
export async function POST() {
  const pending = await db.message.count({ where: { status: 'QUEUED' } })
  if (pending === 0) return Response.json({ started: false, pending: 0 })

  startQueue()
  return Response.json({ started: true, pending })
}
