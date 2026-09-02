import { isInternalRequest, unauthorized } from '@/lib/auth'
import { db } from '@/lib/db'

/** n8n cagirir: kesif calistirmasini kapatir. */
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as {
    runId?: number
    status?: string
    error?: string
  }

  const runId = Number(body.runId)
  if (!Number.isFinite(runId) || runId <= 0) {
    return Response.json({ error: 'runId gerekli.' }, { status: 400 })
  }

  const run = await db.discoveryRun.update({
    where: { id: runId },
    data: {
      status: body.status === 'FAILED' ? 'FAILED' : 'DONE',
      error: body.error?.slice(0, 500) ?? null,
      finishedAt: new Date(),
    },
  })

  return Response.json({ id: run.id, status: run.status, resultCount: run.resultCount })
}
