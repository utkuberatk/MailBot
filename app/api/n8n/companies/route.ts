import { isInternalRequest, unauthorized } from '@/lib/auth'
import { db } from '@/lib/db'
import { upsertCompanies, type IncomingCompany } from '@/lib/companies'

/** n8n cagirir: kesifte bulunan sirketleri kaydeder. */
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as {
    runId?: number
    companies?: IncomingCompany[]
  }

  const companies = Array.isArray(body.companies) ? body.companies : []
  if (companies.length === 0) {
    return Response.json({ created: 0, updated: 0, skipped: 0 })
  }

  const runId = Number(body.runId)
  const hasRun = Number.isFinite(runId) && runId > 0

  const result = await upsertCompanies(companies, {
    source: 'n8n',
    discoveryRunId: hasRun ? runId : undefined,
  })

  if (hasRun) {
    await db.discoveryRun.update({
      where: { id: runId },
      data: { resultCount: { increment: result.created + result.updated } },
    })
  }

  return Response.json(result)
}
