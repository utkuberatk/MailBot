import { db } from '@/lib/db'
import { getQuota } from '@/lib/mailer'
import { env } from '@/lib/env'

/** Panel ve Discord !durum komutu icin ozet sayilar. */
export async function GET() {
  const [companies, sent, opened, clicked, replies, positive, queued, failed, quota] =
    await Promise.all([
      db.company.count({ where: { isActive: true } }),
      db.message.count({ where: { status: 'SENT' } }),
      db.message.count({ where: { openedAt: { not: null } } }),
      db.message.count({ where: { clickCount: { gt: 0 } } }),
      db.reply.count({ where: { deletedAt: null } }),
      db.reply.count({ where: { sentiment: 'POSITIVE', deletedAt: null } }),
      db.message.count({ where: { status: 'QUEUED' } }),
      db.message.count({ where: { status: 'FAILED' } }),
      getQuota(),
    ])

  return Response.json({
    companies,
    sent,
    opened,
    clicked,
    replies,
    positive,
    queued,
    failed,
    quota,
    tracking: { enabled: env.trackingEnabled(), devMode: env.trackingDevMode() },
  })
}
