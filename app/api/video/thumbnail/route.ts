import { isInternalRequest, unauthorized } from '@/lib/auth'
import { generateThumbnail } from '@/lib/video'

/**
 * Video icin play butonlu onizleme uretir.
 * Govde: { source } — YouTube/Vimeo linki veya media/ altindaki dosya adi.
 */
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as { source?: string }
  const source = body.source?.trim()
  if (!source) return Response.json({ error: 'Video bağlantısı ya da dosya adı girin.' }, { status: 400 })

  try {
    return Response.json(await generateThumbnail(source))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Önizleme üretilemedi.'
    return Response.json({ error: message }, { status: 400 })
  }
}
