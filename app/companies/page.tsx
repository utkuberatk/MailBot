'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  source: string
}

type Filters = { cities: string[]; sectors: string[] }

const SOURCE_LABELS: Record<string, string> = {
  n8n: 'Keşif',
  manual: 'Elle',
  csv: 'CSV',
}

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [filters, setFilters] = useState<Filters>({ cities: [], sectors: [] })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [sector, setSector] = useState('')
  const [withEmail, setWithEmail] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (city) params.set('city', city)
    if (sector) params.set('sector', sector)
    if (withEmail) params.set('withEmail', '1')

    const response = await fetch(`/api/companies?${params}`)
    if (response.ok) {
      const data = await response.json()
      setCompanies(data.companies)
      setFilters(data.filters)
    }
    setLoading(false)
  }, [q, city, sector, withEmail])

  // Yazarken her tusa istek atmamak icin kisa gecikme.
  useEffect(() => {
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
  }, [load])

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((current) =>
      current.size === companies.length ? new Set() : new Set(companies.map((c) => c.id)),
    )
  }

  async function removeSelected() {
    if (selected.size === 0) return
    const response = await fetch('/api/companies', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    })
    const data = await response.json()
    setNotice(
      response.ok
        ? { kind: 'ok', text: `${data.deleted} kayıt silindi.` }
        : { kind: 'warn', text: data.error ?? 'Silinemedi.' },
    )
    setSelected(new Set())
    load()
  }

  async function importCsv(file: File) {
    const csv = await file.text()
    const response = await fetch('/api/companies/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    })
    const data = await response.json()
    setNotice(
      response.ok
        ? {
            kind: 'ok',
            text: `${data.created} yeni, ${data.updated} güncellendi, ${data.skipped} atlandı.`,
          }
        : { kind: 'warn', text: data.error ?? 'CSV okunamadı.' },
    )
    if (fileRef.current) fileRef.current.value = ''
    load()
  }

  const withoutEmail = companies.filter((c) => !c.email).length

  return (
    <>
      <PageHeader
        title="Şirketler"
        description="Keşifte bulunan ve elle eklenen tüm kayıtlar. Mail göndermek için buradan seçim yapın."
        action={
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-[var(--color-line)] px-3.5 py-2 text-sm hover:border-[var(--color-brand)]"
            >
              CSV yükle
            </button>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="rounded-lg bg-[var(--color-brand)] px-3.5 py-2 text-sm font-medium text-white"
            >
              Şirket ekle
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) importCsv(file)
              }}
            />
          </div>
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

      {showForm ? (
        <AddCompanyForm
          onDone={(message) => {
            setNotice(message)
            setShowForm(false)
            load()
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ara: şirket, alan adı, e-posta"
            className="min-w-52 flex-1 rounded-lg border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <Select value={city} onChange={setCity} options={filters.cities} placeholder="Tüm şehirler" />
          <Select
            value={sector}
            onChange={setSector}
            options={filters.sectors}
            placeholder="Tüm sektörler"
          />
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={withEmail}
              onChange={(e) => setWithEmail(e.target.checked)}
            />
            Sadece e-postalı
          </label>
        </div>
      </Card>

      {selected.size > 0 ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-4 py-3 text-sm">
          <span className="font-medium text-[var(--color-brand)]">{selected.size} şirket seçili</span>
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/compose?ids=${[...selected].join(',')}`)}
              className="rounded-lg bg-[var(--color-brand)] px-3.5 py-1.5 text-white"
            >
              Seçilenlere mail yaz
            </button>
            <button
              onClick={removeSelected}
              className="rounded-lg border border-[var(--color-warn)] px-3.5 py-1.5 text-[var(--color-warn)]"
            >
              Sil
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <EmptyState title="Yükleniyor…" />
      ) : companies.length === 0 ? (
        <EmptyState
          title="Kayıt yok"
          description="Keşfet sayfasından arama yapın, CSV yükleyin ya da elle şirket ekleyin."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-muted)]">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === companies.length && companies.length > 0}
                    onChange={toggleAll}
                    aria-label="Tümünü seç"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Şirket</th>
                <th className="px-4 py-3 font-medium">E-posta</th>
                <th className="px-4 py-3 font-medium">Telefon</th>
                <th className="px-4 py-3 font-medium">Şehir</th>
                <th className="px-4 py-3 font-medium">Sektör</th>
                <th className="px-4 py-3 font-medium">Kaynak</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr
                  key={company.id}
                  className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-canvas)]"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(company.id)}
                      onChange={() => toggle(company.id)}
                      aria-label={`${company.name} seç`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{company.name}</div>
                    {company.website ? (
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-brand)]"
                      >
                        {company.domain ?? company.website}
                      </a>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {company.email ?? <span className="text-[var(--color-warn)]">yok</span>}
                  </td>
                  <td className="px-4 py-3">{company.phone ?? '—'}</td>
                  <td className="px-4 py-3">{company.city ?? '—'}</td>
                  <td className="px-4 py-3">{company.sector ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                    {SOURCE_LABELS[company.source] ?? company.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {companies.length > 0 ? (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          {companies.length} kayıt
          {withoutEmail > 0 ? ` · ${withoutEmail} tanesinde e-posta yok (mail gönderilemez)` : ''}
        </p>
      ) : null}
    </>
  )
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

function AddCompanyForm({
  onDone,
  onCancel,
}: {
  onDone: (notice: { kind: 'ok' | 'warn'; text: string }) => void
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)

    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(form)),
    })

    const data = await response.json()
    setSaving(false)
    onDone(
      response.ok
        ? { kind: 'ok', text: `${data.name} eklendi.` }
        : { kind: 'warn', text: data.error ?? 'Eklenemedi.' },
    )
  }

  const field =
    'rounded-lg border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]'

  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <input name="name" placeholder="Şirket adı *" required className={field} />
        <input name="email" type="email" placeholder="E-posta" className={field} />
        <input name="website" placeholder="Web sitesi" className={field} />
        <input name="phone" placeholder="Telefon" className={field} />
        <input name="city" placeholder="Şehir" className={field} />
        <input name="sector" placeholder="Sektör" className={field} />
        <div className="flex gap-2 sm:col-span-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm"
          >
            Vazgeç
          </button>
        </div>
      </form>
    </Card>
  )
}
