import { isInternalRequest, unauthorized } from '@/lib/auth'
import { buildSearchQueries } from '@/lib/groq'

/** n8n cagirir: kullanici promptundan arama sorgulari uretir. */
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string }
  if (!prompt?.trim()) return Response.json({ error: 'prompt gerekli.' }, { status: 400 })

  try {
    const queries = await buildSearchQueries(prompt)
    // Model bos donerse promptun kendisiyle devam et.
    return Response.json({ queries: queries.length > 0 ? queries : [prompt] })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: message, queries: [prompt] }, { status: 502 })
  }
}
