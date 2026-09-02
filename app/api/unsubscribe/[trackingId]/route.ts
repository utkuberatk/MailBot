import { db } from '@/lib/db'

/**
 * Listeden cikis. Sirket pasiflestirilir, bir daha mail gonderilmez.
 * GET: linke tiklayan kullanici icin. POST: Gmail'in One-Click cikis istegi.
 */
async function unsubscribe(trackingId: string): Promise<string | null> {
  const message = await db.message.findUnique({
    where: { trackingId },
    select: { companyId: true, company: { select: { name: true } } },
  })
  if (!message) return null

  await db.company.update({
    where: { id: message.companyId },
    data: { isActive: false, notes: 'Listeden çıkış talebi' },
  })
  return message.company.name
}

function page(title: string, message: string, status: number) {
  return new Response(
    `<!doctype html><html lang="tr"><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f7f7f8;color:#18181b">
<div style="text-align:center;padding:24px">
<h2 style="margin:0 0 8px;font-size:20px">${title}</h2>
<p style="color:#71717a;margin:0;font-size:14px">${message}</p>
</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await params
  const name = await unsubscribe(trackingId)

  return name
    ? page('Çıkış tamamlandı', `${name} bu listeden çıkarıldı. Artık mail gönderilmeyecek.`, 200)
    : page('Kayıt bulunamadı', 'Bu bağlantı geçersiz ya da süresi dolmuş.', 404)
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await params
  const name = await unsubscribe(trackingId)
  return Response.json({ ok: Boolean(name), company: name }, { status: name ? 200 : 404 })
}
