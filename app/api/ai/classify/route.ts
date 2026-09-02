import { isInternalRequest, unauthorized } from '@/lib/auth'
import { classifyCompany } from '@/lib/groq'

/** n8n cagirir: site metnine bakip sirketi siniflandirir. */
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as {
    domain?: string
    title?: string
    text?: string
  }

  if (!body.domain) return Response.json({ error: 'domain gerekli.' }, { status: 400 })

  try {
    const result = await classifyCompany({
      domain: body.domain,
      title: body.title ?? '',
      text: body.text ?? '',
    })
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Siniflandirma basarisiz olursa kayit yine de gecsin; kullanici elemeyi
    // sirketler ekranindan yapabilir.
    return Response.json(
      {
        name: body.domain,
        isEcommerce: true,
        sector: null,
        city: null,
        confidence: 0,
        error: message,
      },
      { status: 200 },
    )
  }
}
