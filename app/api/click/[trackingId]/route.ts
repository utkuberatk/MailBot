import { isSafeRedirect, recordEvent, verifyTarget } from '@/lib/tracking'

/**
 * Takipli link: /api/click/{trackingId}?u=<adres>&s=<imza>
 *
 * Imza dogrulanmadan HICBIR yonlendirme yapilmaz. Aksi halde bu uc bir acik
 * yonlendirme olur ve alan adimiz oltalama linklerinde kullanilabilir hale
 * gelir — bu da tum maillerimizi spam'e dusurur.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await params
  const { searchParams } = new URL(request.url)
  const target = searchParams.get('u') ?? ''
  const signature = searchParams.get('s') ?? ''

  if (!target || !isSafeRedirect(target) || !verifyTarget(trackingId, target, signature)) {
    return new Response('Geçersiz bağlantı.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  await recordEvent({ trackingId, type: 'CLICK', target, request })

  return Response.redirect(target, 302)
}
