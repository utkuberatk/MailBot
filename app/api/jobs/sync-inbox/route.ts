import { isInternalRequest, unauthorized } from '@/lib/auth'
import { syncInbox } from '@/lib/inbox'

/** n8n zamanlayicisi (3 dk) ve UI'daki "Yenile" dugmesi buraya gelir. */
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  try {
    return Response.json(await syncInbox())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Senkronizasyon başarısız.'
    return Response.json({ error: message }, { status: 502 })
  }
}
