import { db } from '@/lib/db'
import { getQuota } from '@/lib/mailer'

/** Panel ve Discord !durum komutu icin ozet sayilar. */
export async function GET() {
  const [companies, sent, opened, replies, positive, queued, failed, quota] = await Promise.all([
    db.company.count({ where: { isActive: true } }),
    db.message.count({ where: { status: 'SENT' } }),
    db.message.count({ where: { openedAt: { not: null } } }),
    db.reply.count(),
    db.reply.count({ where: { sentiment: 'POSITIVE' } }),
    db.message.count({ where: { status: 'QUEUED' } }),
    db.message.count({ where: { status: 'FAILED' } }),
    getQuota(),
  ])

  return Response.json({ companies, sent, opened, replies, positive, queued, failed, quota })
}
