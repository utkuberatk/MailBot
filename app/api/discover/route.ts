import { db } from '@/lib/db'
import { env, preferIPv4 } from '@/lib/env'

const SEARXNG_HINT =
  'SearXNG çalışmıyor. Şu komutla başlatın: ' +
  'docker compose -f infra/docker-compose.yml up -d'

/** Servis ayakta mi? Kesif baslamadan once bakilir. */
async function probe(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return `HTTP ${response.status}`
    return null
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return 'zaman aşımı'
    return error instanceof Error ? error.message : String(error)
  }
}

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

  // Adresler n8n'e govdeyle gecer; n8n ayni makinede oldugu icin IPv4'e sabitlenir.
  const appUrl = preferIPv4(env.appUrl())
  const searxngUrl = preferIPv4(env.searxngUrl())

  // On kontrol: SearXNG kapaliysa n8n zinciri sessizce bos doner ve kayit
  // 10 dakika "Calisiyor" gorunur. Bunun yerine hemen anlasilir hata verilir.
  const searxngError = await probe(`${searxngUrl}/search?q=ping&format=json`, 8000)
  if (searxngError) {
    return Response.json({ error: `${SEARXNG_HINT} (${searxngError})` }, { status: 503 })
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
        appUrl,
        searxngUrl,
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200)
      throw new Error(
        response.status === 404
          ? `"mailbot-discovery" workflow'u n8n'de kayıtlı/aktif değil. ` +
            `Yükleyin: npm run workflows && npm run n8n:sync push (n8n yanıtı: ${detail})`
          : `n8n ${response.status}: ${detail}`,
      )
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const message = /fetch failed|ECONNREFUSED|TimeoutError|timed out/i.test(raw)
      ? `n8n'e (${env.n8nBaseUrl()}) ulaşılamadı. n8n açık mı? Ayrıntı: ${raw}`
      : raw

    await db.discoveryRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: message.slice(0, 500), finishedAt: new Date() },
    })

    return Response.json(
      { error: `Keşif otomasyonu tetiklenemedi. ${message}`, runId: run.id },
      { status: 502 },
    )
  }

  return Response.json({ runId: run.id, status: 'RUNNING' })
}
