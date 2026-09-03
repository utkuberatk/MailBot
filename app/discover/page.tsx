'use client'

import { useEffect, useRef, useState } from 'react'
import { PageHeader, Card, EmptyState } from '@/components/ui'

type Company = {
  id: number
  name: string
  domain: string | null
  website: string | null
  email: string | null
  phone: string | null
  city: string | null
  sector: string | null
}

type Run = {
  id: number
  prompt: string
  status: 'RUNNING' | 'DONE' | 'FAILED'
  resultCount: number
  error: string | null
  companies: Company[]
}

const EXAMPLES = ['İstanbul içi butik', 'Doğal kozmetik markaları', 'Ankara ev tekstili mağazaları']

export default function DiscoverPage() {
  const [prompt, setPrompt] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Calisan bir kesif varken sonuclari periyodik olarak tazele.
  useEffect(() => {
    if (!run || run.status !== 'RUNNING') {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }

    pollRef.current = setInterval(async () => {
      const response = await fetch(`/api/discover/runs?runId=${run.id}`)
      if (response.ok) setRun(await response.json())
    }, 3000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [run])

  const busy = starting || run?.status === 'RUNNING'

  async function start(event: React.FormEvent) {
    event.preventDefault()
    // Calisan bir kesif varken ikinci kayit acilmasin (cift tiklama korumasi).
    if (!prompt.trim() || busy) return

    setStarting(true)
    setError(null)
    setRun(null)

    const response = await fetch('/api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })

    const data = await response.json()
    setStarting(false)

    if (!response.ok) {
      setError(data.error ?? 'Keşif başlatılamadı.')
      return
    }

    const detail = await fetch(`/api/discover/runs?runId=${data.runId}`)
    if (detail.ok) setRun(await detail.json())
  }

  return (
    <>
      <PageHeader
        title="Keşfet"
        description="Ne aradığınızı yazın; n8n otomasyonu SearXNG üzerinden şirketleri bulup iletişim bilgilerini çıkarsın."
      />

      <Card>
        <form onSubmit={start} className="flex flex-col gap-3 sm:flex-row">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Örn: İstanbul içi butik"
            className="flex-1 rounded-lg border border-[var(--color-line)] bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <button
            type="submit"
            disabled={busy || !prompt.trim()}
            className="rounded-lg bg-[var(--color-brand)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {starting ? 'Başlatılıyor…' : run?.status === 'RUNNING' ? 'Aranıyor…' : 'Keşfet'}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          <span>Örnekler:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="rounded-full border border-[var(--color-line)] px-2.5 py-1 hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
            >
              {example}
            </button>
          ))}
        </div>
      </Card>

      {error ? (
        <div className="mt-5 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      {run ? (
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-medium">“{run.prompt}”</span>{' '}
              <span className="text-[var(--color-muted)]">
                · {run.companies.length} şirket bulundu
              </span>
            </div>
            <StatusPill status={run.status} />
          </div>

          {run.status === 'FAILED' && run.error ? (
            <div className="mb-3 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm">
              {run.error}
            </div>
          ) : null}

          {run.companies.length > 0 ? (
            <ResultsTable companies={run.companies} />
          ) : (
            <EmptyState
              title={run.status === 'RUNNING' ? 'Aranıyor…' : 'Sonuç bulunamadı'}
              description={
                run.status === 'RUNNING'
                  ? 'n8n siteleri tarıyor. Sonuçlar geldikçe burada listelenecek.'
                  : 'Farklı bir prompt deneyin ya da daha genel bir ifade kullanın.'
              }
            />
          )}
        </div>
      ) : null}
    </>
  )
}

function StatusPill({ status }: { status: Run['status'] }) {
  const map = {
    RUNNING: { label: 'Çalışıyor', bg: 'var(--color-brand-soft)', fg: 'var(--color-brand)' },
    DONE: { label: 'Tamamlandı', bg: 'var(--color-ok-soft)', fg: 'var(--color-ok)' },
    FAILED: { label: 'Hata', bg: 'var(--color-warn-soft)', fg: 'var(--color-warn)' },
  }[status]

  return (
    <span
      className="rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: map.bg, color: map.fg }}
    >
      {map.label}
    </span>
  )
}

function ResultsTable({ companies }: { companies: Company[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-muted)]">
            <th className="px-4 py-3 font-medium">Şirket</th>
            <th className="px-4 py-3 font-medium">E-posta</th>
            <th className="px-4 py-3 font-medium">Telefon</th>
            <th className="px-4 py-3 font-medium">Şehir</th>
            <th className="px-4 py-3 font-medium">Sektör</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id} className="border-b border-[var(--color-line)] last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium">{company.name}</div>
                {company.website ? (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-brand)]"
                  >
                    {company.domain}
                  </a>
                ) : null}
              </td>
              <td className="px-4 py-3">{company.email ?? '—'}</td>
              <td className="px-4 py-3">{company.phone ?? '—'}</td>
              <td className="px-4 py-3">{company.city ?? '—'}</td>
              <td className="px-4 py-3">{company.sector ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
