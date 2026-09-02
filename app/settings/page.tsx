import { PageHeader, Card } from '@/components/ui'
import { missingKeys } from '@/lib/env'

export const dynamic = 'force-dynamic'

type Group = {
  title: string
  note: string
  keys: { key: string; where: string; optional?: boolean }[]
}

const GROUPS: Group[] = [
  {
    title: 'Uygulama',
    note: 'Hazır gelir, değiştirmeniz gerekmez.',
    keys: [
      { key: 'DATABASE_URL', where: 'Sabit: file:./prisma/dev.db' },
      { key: 'APP_INTERNAL_API_KEY', where: 'n8n ve Discord botunun kullandığı iç anahtar' },
    ],
  },
  {
    title: 'Gönderen kimliği',
    note: 'Mail imzasında ve açılma takibinde kullanılır.',
    keys: [
      { key: 'SENDER_NAME', where: 'Mail imzasındaki ad soyad' },
      { key: 'SENDER_TITLE', where: 'Unvan (örn. Kurucu)' },
      { key: 'SENDER_ADDRESS', where: 'İmzada görünen iletişim adresi' },
      {
        key: 'MAIL_TRACKING_URL',
        where: 'Kendi alan adınız (https://mail...). Boşsa takip kapalı — mailler daha temiz gider',
        optional: true,
      },
    ],
  },
  {
    title: 'Groq AI',
    note: 'Mail iyileştirme ve yanıt analizi için gerekli.',
    keys: [{ key: 'GROQ_API_KEY', where: 'console.groq.com → API Keys' }],
  },
  {
    title: 'Gmail',
    note: 'Mail gönderimi ve yanıtların okunması için gerekli (Faz 5).',
    keys: [
      { key: 'GMAIL_CLIENT_ID', where: 'Google Cloud Console → Credentials → OAuth (Desktop app)' },
      { key: 'GMAIL_CLIENT_SECRET', where: 'Aynı OAuth istemcisi' },
      { key: 'GMAIL_REFRESH_TOKEN', where: 'npm run gmail:auth komutu üretir' },
      { key: 'GMAIL_USER', where: 'Gönderim yapılacak Gmail adresi' },
    ],
  },
  {
    title: 'n8n',
    note: 'Keşif otomasyonunu tetiklemek için gerekli (Faz 2-3).',
    keys: [
      { key: 'N8N_API_KEY', where: 'n8n → Settings → n8n API → Create an API key' },
      { key: 'N8N_BASE_URL', where: 'Sabit: http://localhost:5678' },
    ],
  },
  {
    title: 'Discord',
    note: 'Uzaktan bildirim ve komutlar için gerekli (Faz 7).',
    keys: [
      { key: 'DISCORD_BOT_TOKEN', where: 'discord.com/developers → Bot → Reset Token' },
      { key: 'DISCORD_CHANNEL_ID', where: 'Geliştirici modu → kanala sağ tık → ID kopyala' },
      { key: 'DISCORD_OWNER_ID', where: 'Kendi Discord kullanıcı ID’niz' },
    ],
  },
]

export default function SettingsPage() {
  // Opsiyonel anahtarlar "eksik" sayilmaz; bos olmalari gecerli bir durum.
  const requiredKeys = GROUPS.flatMap((g) => g.keys.filter((k) => !k.optional).map((k) => k.key))
  const missing = new Set(missingKeys(requiredKeys))
  const optional = new Set(GROUPS.flatMap((g) => g.keys.filter((k) => k.optional).map((k) => k.key)))
  const unset = new Set(missingKeys([...optional]))

  return (
    <>
      <PageHeader
        title="Ayarlar"
        description="Anahtarlar .env dosyasından okunur. Eksik olanları doldurup uygulamayı yeniden başlatın."
      />

      {missing.size > 0 ? (
        <div className="mb-5 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm">
          <span className="font-medium">{missing.size} anahtar eksik.</span> Aşağıda kırmızı
          işaretli olanları <code className="font-mono text-xs">.env</code> dosyanıza ekleyin.
        </div>
      ) : (
        <div className="mb-5 rounded-xl border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-4 py-3 text-sm">
          Tüm anahtarlar tanımlı.
        </div>
      )}

      <div className="grid gap-4">
        {GROUPS.map((group) => (
          <Card key={group.title}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">{group.title}</h2>
              <span className="text-xs text-[var(--color-muted)]">{group.note}</span>
            </div>
            <ul className="mt-3 divide-y divide-[var(--color-line)]">
              {group.keys.map(({ key, where }) => {
                const isMissing = missing.has(key)
                const isOptionalUnset = unset.has(key)
                return (
                  <li key={key} className="flex items-center justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <div className="font-mono text-[13px]">{key}</div>
                      <div className="truncate text-xs text-[var(--color-muted)]">{where}</div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
                      style={{
                        background: isMissing
                          ? 'var(--color-warn-soft)'
                          : isOptionalUnset
                            ? 'var(--color-canvas)'
                            : 'var(--color-ok-soft)',
                        color: isMissing
                          ? 'var(--color-warn)'
                          : isOptionalUnset
                            ? 'var(--color-muted)'
                            : 'var(--color-ok)',
                      }}
                    >
                      {isMissing ? 'Eksik' : isOptionalUnset ? 'Kapalı' : 'Tanımlı'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  )
}
