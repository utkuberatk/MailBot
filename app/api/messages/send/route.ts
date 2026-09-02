import { db } from '@/lib/db'
import { isInternalRequest, unauthorized } from '@/lib/auth'
import { queueCampaign, startQueue, getQuota } from '@/lib/mailer'

/**
 * Kampanya olusturur (veya mevcut kampanyayi kullanir) ve secili sirketleri
 * gonderim kuyruguna alir.
 *
 * Govde: { campaignId } veya { subject, body, videoUrl?, videoThumbPath?,
 *          originalDraft?, spamScore?, name? } + { companyIds: number[] }
 */
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as {
    campaignId?: number
    name?: string
    subject?: string
    body?: string
    originalDraft?: string
    videoUrl?: string
    videoThumbPath?: string
    spamScore?: number
    companyIds?: number[]
  }

  const companyIds = (body.companyIds ?? []).filter((id) => Number.isFinite(id))
  if (companyIds.length === 0) {
    return Response.json({ error: 'Gönderilecek şirket seçin.' }, { status: 400 })
  }

  let campaignId = body.campaignId

  if (!campaignId) {
    const subject = body.subject?.trim()
    const template = body.body?.trim()
    if (!subject || !template) {
      return Response.json({ error: 'Konu ve mail metni zorunlu.' }, { status: 400 })
    }

    const campaign = await db.campaign.create({
      data: {
        name: body.name?.trim() || `${subject} — ${new Date().toLocaleDateString('tr-TR')}`,
        subject,
        bodyTemplate: template,
        originalDraft: body.originalDraft?.trim() || null,
        videoUrl: body.videoUrl?.trim() || null,
        videoThumbPath: body.videoThumbPath?.trim() || null,
        spamScore: typeof body.spamScore === 'number' ? body.spamScore : null,
      },
    })
    campaignId = campaign.id
  }

  try {
    const result = await queueCampaign(campaignId, companyIds)
    if (result.queued > 0) startQueue()

    const quota = await getQuota()
    return Response.json({ campaignId, ...result, quota })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kuyruğa alınamadı.'
    return Response.json({ error: message }, { status: 400 })
  }
}
