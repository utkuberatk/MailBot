'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageHeader, Card, EmptyState } from '@/components/ui'

type Reply = {
  id: number
  fromEmail: string
  bodyText: string
  sentiment: string
  sentimentScore: number | null
  summary: string | null
  receivedAt: string
  answeredAt: string | null
  message: {
    id: number
    subject: string
    sentAt: string | null
    openedAt: string | null
    company: { id: number; name: string; domain: string | null }
  }
}

type Message = {
  id: number
  toEmail: string
  subject: string
  status: string
  sentAt: string | null
  openedAt: string | null
  openCount: number
  error: string | null
  company: { id: number; name: string; domain: string | null }
  replies: { id: number; sentiment: string; summary: string | null }[]
}

type Stats = { byStatus: Record<string, number>; opened: number }

const SENTIMENT_LABELS: Record<string, string> = {
  POSITIVE: 'Olumlu',
  NEUTRAL: 'Nötr',
  NEGATIVE: 'Olumsuz',
}

export default function InboxPage() {
  const [tab, setTab] = useState<'replies' | 'sent'>('replies')
  const [onlyPositive, setOnlyPositive] = useState(true)

  const [replies, setReplies] = useState<Reply[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [replyResponse, messageResponse] = await Promise.all([
      fetch(`/api/replies${onlyPositive ? '?sentiment=POSITIVE' : ''}`),
      fetch('/api/messages'),
    ])

    if (replyResponse.ok) setReplies((await replyResponse.json()).replies)
    if (messageResponse.ok) {
      const data = await messageResponse.json()
      setMessages(data.messages)
      setStats(data.stats)
    }
    setLoading(false)
  }, [onlyPositive])

  useEffect(() => {
    load()
  }, [load])

  /** O an listelenen yanitlarin hepsini kaldirir (filtreye saygi duyar). */
  async function clearListed() {
    const response = await fetch('/api/replies', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: replies.map((reply) => reply.id) }),
    })

    const data = await response.json()
    setClearing(false)
    setNotice(response.ok ? `${data.deleted} yanıt listeden kaldırıldı.` : 'Yanıtlar silinemedi.')
    load()
  }

  async function sync() {
    setSyncing(true)
    setNotice(null)

    const response = await fetch('/api/jobs/sync-inbox', { method: 'POST' })
    const data = await response.json()
    setSyncing(false)

    setNotice(
      response.ok
        ? `${data.scanned} mail tarandı, ${data.newReplies} yeni yanıt (${data.positive} olumlu).` +
            (data.errors?.length ? ` ${data.errors.length} hata.` : '')
        : (data.error ?? 'Senkronizasyon başarısız.'),
    )
    load()
  }

  return (
    <>
      <PageHeader
        title="Gelen Kutusu"
        description="Gönderilen maillerin durumu ve gelen yanıtların AI analizi."
        action={
          <button
            onClick={sync}
            disabled={syncing}
            className="rounded-lg bg-[var(--color-brand)] px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {syncing ? 'Taranıyor…' : 'Yanıtları çek'}
          </button>
        }
      />

      {notice ? (
        <div className="mb-4 rounded-xl bg-[var(--color-brand-soft)] px-4 py-3 text-sm text-[var(--color-brand)]">
          {notice}
        </div>
      ) : null}

      {stats ? (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <Pill label="Gönderildi" value={stats.byStatus.SENT ?? 0} />
          <Pill label="Açıldı" value={stats.opened} tone="ok" />
          <Pill label="Kuyrukta" value={stats.byStatus.QUEUED ?? 0} />
          <Pill label="Hatalı" value={stats.byStatus.FAILED ?? 0} tone="warn" />
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-4">
        <div className="flex gap-1 rounded-lg border border-[var(--color-line)] p-1">
          <TabButton active={tab === 'replies'} onClick={() => setTab('replies')}>
            Yanıtlar
          </TabButton>
          <TabButton active={tab === 'sent'} onClick={() => setTab('sent')}>
            Gönderilenler
          </TabButton>
        </div>

        {tab === 'replies' ? (
          <>
            <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <input
                type="checkbox"
                checked={onlyPositive}
                onChange={(e) => setOnlyPositive(e.target.checked)}
              />
              Sadece OLUMLU
            </label>

            {replies.length > 0 ? (
              clearing ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--color-muted)]">
                    Listedeki {replies.length} yanıt silinsin mi?
                  </span>
                  <button
                    onClick={clearListed}
                    className="rounded-lg bg-[var(--color-warn)] px-3 py-1 text-sm text-white"
                  >
                    Evet, sil
                  </button>
                  <button
                    onClick={() => setClearing(false)}
                    className="rounded-lg border border-[var(--color-line)] px-3 py-1 text-sm"
                  >
                    Vazgeç
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setClearing(true)}
                  className="ml-auto text-sm text-[var(--color-muted)] hover:text-[var(--color-warn)]"
                >
                  Listeyi temizle
                </button>
              )
            ) : null}
          </>
        ) : null}
      </div>

      {loading ? (
        <EmptyState title="Yükleniyor…" />
      ) : tab === 'replies' ? (
        replies.length === 0 ? (
          <EmptyState
            title="Yanıt yok"
            description={
              onlyPositive
                ? 'Henüz olumlu yanıt gelmedi. Filtreyi kaldırıp tüm yanıtlara bakabilirsiniz.'
                : 'Gelen yanıt yok. "Yanıtları çek" ile Gmail’i tarayın.'
            }
          />
        ) : (
          <div className="grid gap-3">
            {replies.map((reply) => (
              <ReplyCard
                key={reply.id}
                reply={reply}
                onAnswered={load}
                onDeleted={() => {
                  setNotice('Yanıt listeden kaldırıldı.')
                  load()
                }}
              />
            ))}
          </div>
        )
      ) : messages.length === 0 ? (
        <EmptyState title="Gönderilen mail yok" description="Mail Yaz sayfasından gönderim yapın." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-muted)]">
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 font-medium">Şirket</th>
                <th className="px-4 py-3 font-medium">Konu</th>
                <th className="px-4 py-3 font-medium">Gönderim</th>
                <th className="px-4 py-3 font-medium">Açılma</th>
                <th className="px-4 py-3 font-medium">Yanıt</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => (
                <tr
                  key={message.id}
                  className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-canvas)]"
                >
                  <td className="px-4 py-3">
                    <StatusDot message={message} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{message.company.name}</div>
                    <div className="text-xs text-[var(--color-muted)]">{message.toEmail}</div>
                  </td>
                  <td className="max-w-64 truncate px-4 py-3">{message.subject}</td>
                  <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                    {message.sentAt ? new Date(message.sentAt).toLocaleString('tr-TR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {message.openedAt ? (
                      <span className="text-[var(--color-ok)]">
                        {new Date(message.openedAt).toLocaleString('tr-TR')}
                        {message.openCount > 1 ? ` (${message.openCount}×)` : ''}
                      </span>
                    ) : (
                      <span className="text-[var(--color-warn)]">açılmadı</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {message.replies.length > 0
                      ? SENTIMENT_LABELS[message.replies[0].sentiment] ?? message.replies[0].sentiment
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** Yesil = acildi, kirmizi = acilmadi (CLAUDE.md bolum 5). */
function StatusDot({ message }: { message: Message }) {
  if (message.status === 'FAILED') {
    return <span title={message.error ?? 'Hata'} className="text-xs text-[var(--color-warn)]">hata</span>
  }
  if (message.status === 'QUEUED') {
    return <span className="text-xs text-[var(--color-muted)]">kuyrukta</span>
  }

  const opened = Boolean(message.openedAt)
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: opened ? 'var(--color-ok)' : 'var(--color-warn)' }}
      title={opened ? 'Açıldı' : 'Henüz açılmadı'}
    />
  )
}

function Pill({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  return (
    <span
      className="rounded-full px-3 py-1"
      style={{
        background:
          tone === 'ok'
            ? 'var(--color-ok-soft)'
            : tone === 'warn'
              ? 'var(--color-warn-soft)'
              : 'var(--color-brand-soft)',
        color:
          tone === 'ok'
            ? 'var(--color-ok)'
            : tone === 'warn'
              ? 'var(--color-warn)'
              : 'var(--color-brand)',
      }}
    >
      {label}: <strong className="tabular-nums">{value}</strong>
    </span>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm ${
        active ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-muted)]'
      }`}
    >
      {children}
    </button>
  )
}

function ReplyCard({
  reply,
  onAnswered,
  onDeleted,
}: {
  reply: Reply
  onAnswered: () => void
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const tone =
    reply.sentiment === 'POSITIVE' ? 'ok' : reply.sentiment === 'NEGATIVE' ? 'warn' : 'muted'

  async function remove() {
    setDeleting(true)

    const response = await fetch('/api/replies', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [reply.id] }),
    })

    setDeleting(false)
    setConfirming(false)
    if (response.ok) onDeleted()
    else setResult('Yanıt silinemedi.')
  }

  async function answer() {
    if (!text.trim()) return
    setSending(true)

    const response = await fetch(`/api/replies/${reply.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    const data = await response.json()
    setSending(false)
    setResult(response.ok ? `Gönderildi: ${data.sentText}` : (data.error ?? 'Gönderilemedi.'))
    if (response.ok) {
      setText('')
      onAnswered()
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{reply.message.company.name}</span>
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{
                background:
                  tone === 'ok'
                    ? 'var(--color-ok-soft)'
                    : tone === 'warn'
                      ? 'var(--color-warn-soft)'
                      : 'var(--color-canvas)',
                color:
                  tone === 'ok'
                    ? 'var(--color-ok)'
                    : tone === 'warn'
                      ? 'var(--color-warn)'
                      : 'var(--color-muted)',
              }}
            >
              {SENTIMENT_LABELS[reply.sentiment] ?? reply.sentiment}
              {reply.sentimentScore ? ` · ${Math.round(reply.sentimentScore * 100)}%` : ''}
            </span>
            {reply.answeredAt ? (
              <span className="text-xs text-[var(--color-muted)]">yanıtlandı</span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-muted)]">
            {reply.fromEmail} · {new Date(reply.receivedAt).toLocaleString('tr-TR')} ·{' '}
            <span className="font-mono">#{reply.message.id}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm"
          >
            {open ? 'Kapat' : 'Yanıtla'}
          </button>

          {/* Geri alinamayan islem: tek tikla degil, onayla silinir. */}
          {confirming ? (
            <>
              <button
                onClick={remove}
                disabled={deleting}
                className="rounded-lg bg-[var(--color-warn)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {deleting ? 'Siliniyor…' : 'Evet, sil'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm"
              >
                Vazgeç
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              title="Bu yanıtı listeden kaldır"
              className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:border-[var(--color-warn)] hover:text-[var(--color-warn)]"
            >
              Sil
            </button>
          )}
        </div>
      </div>

      {reply.summary ? <p className="mt-3 text-sm">{reply.summary}</p> : null}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-[var(--color-muted)]">Tam metin</summary>
        <pre className="mt-2 text-sm whitespace-pre-wrap text-[var(--color-muted)]">
          {reply.bodyText}
        </pre>
      </details>

      {open ? (
        <div className="mt-3 border-t border-[var(--color-line)] pt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Kısa notunuzu yazın — AI doğal bir yanıta çevirip thread'e gönderir."
            className="w-full rounded-lg border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <button
            onClick={answer}
            disabled={sending || !text.trim()}
            className="mt-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {sending ? 'Gönderiliyor…' : 'AI ile düzelt ve gönder'}
          </button>
          {result ? <p className="mt-2 text-xs text-[var(--color-muted)]">{result}</p> : null}
        </div>
      ) : null}
    </Card>
  )
}
