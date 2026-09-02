import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * Kesif baslatir: DiscoveryRun kaydi acar ve n8n webhook'unu tetikler.
 * n8n sonuclari /api/n8n/companies ucuna geri gonderir.
 */
export async function POST(request: Request) {
  let body: { prompt?: string; triggeredBy?: string; limit?: number }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Gecersiz istek govdesi.' }, { status: 400 })
  }

  const prompt = body.prompt?.trim()
  if (!prompt) {
    return Response.json({ error: 'Bir arama promptu yazmalisiniz.' }, { status: 400 })
  }

  const run = await db.discoveryRun.create({
    data: { prompt, triggeredBy: body.triggeredBy === 'discord' ? 'discord' : 'ui' },
  })

  const webhookUrl = env.n8nDiscoverWebhook()

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: run.id,
        prompt,
        limit: body.limit ?? 25,
        // Servis adresleri n8n'e buradan gecilir; boylece n8n tarafinda
        // ayar tutmaya gerek kalmaz. n8n Docker icinde calisiyorsa .env'de
        // APP_URL ve SEARXNG_URL'i host.docker.internal ile yazin.
        appUrl: env.appUrl(),
        searxngUrl: env.searxngUrl(),
      }),
    })

    if (!response.ok) throw new Error(`n8n ${response.status}: ${await response.text()}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.discoveryRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: message, finishedAt: new Date() },
    })

    return Response.json(
      {
        error:
          'n8n keşif otomasyonu tetiklenemedi. n8n çalışıyor mu ve "mailbot-discovery" ' +
          'workflow aktif mi? Ayrıntı: ' +
          message,
        runId: run.id,
      },
      { status: 502 },
    )
  }

  return Response.json({ runId: run.id, status: 'RUNNING' })
}
