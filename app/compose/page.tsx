'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PageHeader, Card, EmptyState } from '@/components/ui'

type Company = {
  id: number
  name: string
  email: string | null
  city: string | null
  sector: string | null
  domain: string | null
}

type Quota = {
  dailyLimit: number
  hourlyLimit: number
  remainingToday: number
  remainingThisHour: number
}

type Improved = { subject: string; body: string; spamScore: number; warnings: string[] }

const PLACEHOLDER = `Merhaba {{company}} ekibi,

`

export default function ComposePage() {
  return (
    <Suspense fallback={<EmptyState title="Yükleniyor…" />}>
      <Compose />
    </Suspense>
  )
}

function Compose() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [companies, setCompanies] = useState<Company[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)

  const [subject, setSubject] = useState('')
  const [draft, setDraft] = useState(PLACEHOLDER)
  const [originalDraft, setOriginalDraft] = useState<string | null>(null)
  const [improving, setImproving] = useState(false)
  const [review, setReview] = useState<Improved | null>(null)

  const [videoUrl, setVideoUrl] = useState('')
  const [thumbPath, setThumbPath] = useState('')
  const [thumbNote, setThumbNote] = useState('')
  const [thumbBusy, setThumbBusy] = useState(false)

  const [quota, setQuota] = useState<Quota | null>(null)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)

  const load = useCallback(async () => {
    const [companyResponse, messageResponse] = await Promise.all([
      fetch('/api/companies?withEmail=1'),
      fetch('/api/messages'),
    ])

    if (companyResponse.ok) {
      const data = await companyResponse.json()
      setCompanies(data.companies)

      // /companies sayfasindan gelen secim.
      const ids = searchParams.get('ids')
      if (ids) {
        const wanted = new Set(ids.split(',').map(Number).filter(Number.isFinite))
        setSelected(new Set(data.companies.filter((c: Company) => wanted.has(c.id)).map((c: Company) => c.id)))
      }
    }

    if (messageResponse.ok) setQuota((await messageResponse.json()).quota)
    setLoading(false)
  }, [searchParams])

  useEffect(() => {
    load()
  }, [load])

  const chosen = companies.filter((company) => selected.has(company.id))
  const sample = chosen[0] ?? companies[0]

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function improve() {
    if (!sample) {
      setNotice({ kind: 'warn', text: 'Önce en az bir şirket seçin.' })
      return
    }
    setImproving(true)
    setNotice(null)

    const response = await fetch('/api/ai/improve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft,
        subject,
        company: { name: sample.name, sector: sample.sector, city: sample.city },
      }),
    })

    const data = await response.json()
    setImproving(false)

    if (!response.ok) {
      setNotice({ kind: 'warn', text: data.error ?? 'İyileştirilemedi.' })
      return
    }
    setReview(data)
  }

  function acceptImproved() {
    if (!review) return
    setOriginalDraft(draft)
    // Ornek sirket adini sablon degiskenine geri cevir; herkese kisisellessin.
    const templated = sample
      ? review.body.split(sample.name).join('{{company}}')
      : review.body
    setDraft(templated)
    setSubject(sample ? review.subject.split(sample.name).join('{{company}}') : review.subject)
    setReview(null)
  }

  async function makeThumbnail() {
    if (!videoUrl.trim()) return
    setThumbBusy(true)
    setThumbNote('')

    const response = await fetch('/api/video/thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: videoUrl.trim() }),
    })

    const data = await response.json()
    setThumbBusy(false)

    if (!response.ok) {
      setThumbNote(data.error ?? 'Önizleme üretilemedi.')
      return
    }
    setThumbPath(data.path)
    setThumbNote(data.warning ?? 'Önizleme hazır.')
  }

  async function send() {
    if (selected.size === 0 || !subject.trim() || !draft.trim()) {
      setNotice({ kind: 'warn', text: 'Konu, mail metni ve en az bir şirket gerekli.' })
      return
    }

    setSending(true)
    const response = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        body: draft,
        originalDraft,
        videoUrl: videoUrl.trim() || undefined,
        videoThumbPath: thumbPath || undefined,
        spamScore: review?.spamScore,
        companyIds: [...selected],
      }),
    })

    const data = await response.json()
    setSending(false)

    if (!response.ok) {
      setNotice({ kind: 'warn', text: data.error ?? 'Gönderilemedi.' })
      return
    }

    const skipped = (data.skipped as { company: string; reason: string }[]) ?? []
    setNotice({
      kind: data.queued > 0 ? 'ok' : 'warn',
      text:
        `${data.queued} mail kuyruğa alındı` +
        (skipped.length > 0
          ? `, ${skipped.length} atlandı: ${skipped.map((s) => `${s.company} (${s.reason})`).join(', ')}`
          : '.') +
        ' Gönderim aralarında 45-90 sn bekleyerek arka planda sürüyor.',
    })
    setQuota(data.quota)
    if (data.queued > 0) setTimeout(() => router.push('/inbox'), 2500)
  }

  const field =
    'w-full rounded-lg border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]'

  return (
    <>
      <PageHeader
        title="Mail Yaz"
        description="Taslağı yazın, AI dili düzeltsin, video önizlemesi ekleyip seçili şirketlere kuyruklu gönderin."
        action={
          quota ? (
            <div className="text-right text-xs text-[var(--color-muted)]">
              <div>
                Bugün kalan: <strong className="tabular-nums">{quota.remainingToday}</strong> /{' '}
                {quota.dailyLimit}
              </div>
              <div>
                Bu saat: <strong className="tabular-nums">{quota.remainingThisHour}</strong> /{' '}
                {quota.hourlyLimit}
              </div>
            </div>
          ) : null
        }
      />

      {notice ? (
        <div
          className="mb-4 rounded-xl px-4 py-3 text-sm"
          style={{
            background: notice.kind === 'ok' ? 'var(--color-ok-soft)' : 'var(--color-warn-soft)',
            color: notice.kind === 'ok' ? 'var(--color-ok)' : 'var(--color-warn)',
          }}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-4">
          <Card>
            <label className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">
              Konu
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="{{company}} için kısa bir teklif"
              className={field}
            />

            <label className="mt-4 mb-1.5 block text-xs font-medium text-[var(--color-muted)]">
              Mail metni
            </label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              className={`${field} resize-y font-[inherit] leading-relaxed`}
            />
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              Değişkenler: <code>{'{{company}}'}</code> <code>{'{{city}}'}</code>{' '}
              <code>{'{{sector}}'}</code> — şirket adı geçmeyen mail gönderilmez.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={improve}
                disabled={improving || !draft.trim()}
                className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {improving ? 'İyileştiriliyor…' : 'AI ile iyileştir'}
              </button>
              {originalDraft ? (
                <button
                  onClick={() => {
                    setDraft(originalDraft)
                    setOriginalDraft(null)
                  }}
                  className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm"
                >
                  Orijinali geri getir
                </button>
              ) : null}
            </div>
          </Card>

          {review ? (
            <Card>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">AI önerisi</h2>
                <SpamBadge score={review.spamScore} />
              </div>
              <p className="mb-1 text-xs text-[var(--color-muted)]">Konu</p>
              <p className="mb-3 text-sm font-medium">{review.subject}</p>
              <p className="mb-1 text-xs text-[var(--color-muted)]">Metin</p>
              <pre className="mb-3 text-sm whitespace-pre-wrap">{review.body}</pre>

              {review.warnings.length > 0 ? (
                <ul className="mb-3 list-inside list-disc text-xs text-[var(--color-warn)]">
                  {review.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}

              <div className="flex gap-2">
                <button
                  onClick={acceptImproved}
                  className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white"
                >
                  Bunu kullan
                </button>
                <button
                  onClick={() => setReview(null)}
                  className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm"
                >
                  Vazgeç
                </button>
              </div>
            </Card>
          ) : null}

          <Card>
            <h2 className="mb-3 text-sm font-semibold">Video (opsiyonel)</h2>
            <div className="flex flex-wrap gap-2">
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="YouTube/Vimeo linki ya da media/ içindeki dosya adı"
                className={`${field} flex-1`}
              />
              <button
                onClick={makeThumbnail}
                disabled={thumbBusy || !videoUrl.trim()}
                className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm whitespace-nowrap disabled:opacity-50"
              >
                {thumbBusy ? 'Üretiliyor…' : 'Önizleme üret'}
              </button>
            </div>

            {thumbNote ? (
              <p className="mt-2 text-xs text-[var(--color-muted)]">{thumbNote}</p>
            ) : null}

            {thumbPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbPath}
                alt="Video önizleme"
                className="mt-3 max-w-sm rounded-lg border border-[var(--color-line)]"
              />
            ) : null}
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Alıcılar</h2>
              <span className="text-xs text-[var(--color-muted)]">{selected.size} seçili</span>
            </div>

            {loading ? (
              <p className="text-sm text-[var(--color-muted)]">Yükleniyor…</p>
            ) : companies.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">
                E-posta adresi olan şirket yok. Önce Keşfet ya da Şirketler sayfasını kullanın.
              </p>
            ) : (
              <>
                <button
                  onClick={() =>
                    setSelected((current) =>
                      current.size === companies.length
                        ? new Set()
                        : new Set(companies.map((c) => c.id)),
                    )
                  }
                  className="mb-2 text-xs text-[var(--color-brand)]"
                >
                  {selected.size === companies.length ? 'Seçimi kaldır' : 'Tümünü seç'}
                </button>
                <div className="max-h-96 overflow-y-auto">
                  {companies.map((company) => (
                    <label
                      key={company.id}
                      className="flex cursor-pointer items-start gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-0"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(company.id)}
                        onChange={() => toggle(company.id)}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{company.name}</span>
                        <span className="block truncate text-xs text-[var(--color-muted)]">
                          {company.email}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card>
            <button
              onClick={send}
              disabled={sending || selected.size === 0}
              className="w-full rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {sending ? 'Kuyruğa alınıyor…' : `${selected.size} şirkete gönder`}
            </button>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              Mailler arasında 45-90 sn beklenir; saatlik ve günlük limitler uygulanır.
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}

function SpamBadge({ score }: { score: number }) {
  const level = score < 0.34 ? 'ok' : score < 0.67 ? 'warn' : 'warn'
  const label = score < 0.34 ? 'Spam riski düşük' : score < 0.67 ? 'Spam riski orta' : 'Spam riski yüksek'

  return (
    <span
      className="rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: level === 'ok' ? 'var(--color-ok-soft)' : 'var(--color-warn-soft)',
        color: level === 'ok' ? 'var(--color-ok)' : 'var(--color-warn)',
      }}
    >
      {label} · {Math.round(score * 100)}%
    </span>
  )
}
