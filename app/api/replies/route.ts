import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'

/** Gelen yanitlar. ?sentiment=POSITIVE ?notified=0 (bot bildirimi bekleyenler) */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sentiment = searchParams.get('sentiment')?.trim()
  const notified = searchParams.get('notified')

  // Silinen yanitlar listelenmez.
  const where: Prisma.ReplyWhereInput = { deletedAt: null }
  if (sentiment) where.sentiment = sentiment
  if (notified === '0') where.discordNotifiedAt = null

  const replies = await db.reply.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: 200,
    include: {
      message: {
        select: {
          id: true,
          subject: true,
          sentAt: true,
          openedAt: true,
          company: { select: { id: true, name: true, domain: true } },
        },
      },
    },
  })

  return Response.json({ replies })
}

/** Bot bildirimi gonderdikten sonra isaretler. Govde: { ids: number[] } */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: number[] }
  const ids = (body.ids ?? []).filter((id) => Number.isFinite(id))
  if (ids.length === 0) return Response.json({ error: 'ids boş.' }, { status: 400 })

  const result = await db.reply.updateMany({
    where: { id: { in: ids } },
    data: { discordNotifiedAt: new Date() },
  })
  return Response.json({ updated: result.count })
}

/**
 * Yaniti listeden kaldirir. Govde: { ids: number[] }
 *
 * Kayit fiziksel olarak silinmez; `deletedAt` doldurulur. Boylece 3 dakikada
 * bir calisan gelen kutusu senkronizasyonu ayni Gmail mesajini yeniden
 * eklemez — kayit durdugu icin "zaten islenmis" sayilir.
 */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: number[] }
  const ids = (body.ids ?? []).filter((id) => Number.isFinite(id))
  if (ids.length === 0) return Response.json({ error: 'Silinecek yanıt seçin.' }, { status: 400 })

  const result = await db.reply.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  return Response.json({ deleted: result.count })
}
