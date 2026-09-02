import type { ReactNode } from 'react'

/** Sayfa basligi + aciklama + sag taraf aksiyonlari. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--color-muted)]">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** Temel yuzey kutusu. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>
}

/** Panel ustundeki sayi kutusu. */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: number | string
  hint?: string
  tone?: 'default' | 'ok' | 'warn'
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-[var(--color-ok)]'
      : tone === 'warn'
        ? 'text-[var(--color-warn)]'
        : 'text-[var(--color-ink)]'

  return (
    <div className="card p-5">
      <div className="text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--color-muted)]">{hint}</div> : null}
    </div>
  )
}

/** Icerik olmadiginda gosterilen bos durum. */
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="card px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--color-muted)]">{description}</p>
      ) : null}
    </div>
  )
}

/** Henuz yazilmamis sayfalar icin gecici govde (ilgili fazda degistirilecek). */
export function ComingSoon({ phase }: { phase: string }) {
  return (
    <EmptyState
      title="Bu bölüm henüz hazır değil"
      description={`${phase} tamamlandığında burası çalışır hale gelecek.`}
    />
  )
}
