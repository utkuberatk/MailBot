import { db } from '@/lib/db'
import { isInternalRequest, unauthorized } from '@/lib/auth'

/**
 * Discord'a bildirilecek acilmalar.
 *
 * /api/replies ile ayni desen: bot bildirilmemisleri GET ile alir, kanala
 * duser, sonra PATCH ile damgalar. Boylece uygulama yeniden basladiginda
 * ayni acilma iki kez bildirilmez.
 */
export async function GET(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  const messages = await db.message.findMany({
    where: { openedAt: { not: null }, openNotifiedAt: null },
    orderBy: { openedAt: 'asc' },
    take: 25,
    select: {
      id: true,
      subject: true,
      toEmail: true,
      sentAt: true,
      openedAt: true,
      lastOpenedAt: true,
      openCount: true,
      clickCount: true,
      company: { select: { id: true, name: true } },
    },
  })

  return Response.json({ messages })
}

/** Bildirimi yapilan mesajlari damgalar. */
export async function PATCH(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as { ids?: number[] }
  const ids = (body.ids ?? []).filter((id) => Number.isInteger(id))
  if (ids.length === 0) return Response.json({ updated: 0 })

  const result = await db.message.updateMany({
    where: { id: { in: ids } },
    data: { openNotifiedAt: new Date() },
  })

  return Response.json({ updated: result.count })
}
