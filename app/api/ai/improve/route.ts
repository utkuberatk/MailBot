import { improveEmail } from '@/lib/groq'
import { MissingEnvError } from '@/lib/env'
import { isInternalRequest, unauthorized } from '@/lib/auth'

/**
 * Mail taslagini Groq ile iyilestirir.
 * Govde: { draft, subject, company: { name, sector?, city? } }
 */
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as {
    draft?: string
    subject?: string
    company?: { name?: string; sector?: string | null; city?: string | null }
  }

  const draft = body.draft?.trim()
  if (!draft) return Response.json({ error: 'Taslak metin boş.' }, { status: 400 })

  const companyName = body.company?.name?.trim()
  if (!companyName) {
    return Response.json({ error: 'Örnek şirket seçilmeli.' }, { status: 400 })
  }

  try {
    const result = await improveEmail({
      draft,
      subject: body.subject?.trim() || '',
      company: { name: companyName, sector: body.company?.sector, city: body.company?.city },
    })
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI isteği başarısız.'
    return Response.json({ error: message }, { status: error instanceof MissingEnvError ? 400 : 502 })
  }
}
