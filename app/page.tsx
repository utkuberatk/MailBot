import { db } from '@/lib/db'
import { PageHeader, StatCard, Card } from '@/components/ui'

export const dynamic = 'force-dynamic'

async function getStats() {
  const [companies, sent, opened, replies, positive] = await Promise.all([
    db.company.count({ where: { isActive: true } }),
    db.message.count({ where: { status: 'SENT' } }),
    db.message.count({ where: { openedAt: { not: null } } }),
    db.reply.count(),
    db.reply.count({ where: { sentiment: 'POSITIVE' } }),
  ])
  return { companies, sent, opened, replies, positive }
}

export default async function DashboardPage() {
  const stats = await getStats()
  const openRate = stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0

  return (
    <>
      <PageHeader
        title="Panel"
        description="Sistemin genel durumu. Tüm veriler bu makinedeki yerel veritabanından okunur."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Şirket" value={stats.companies} hint="Aktif kayıt" />
        <StatCard label="Gönderilen" value={stats.sent} />
        <StatCard
          label="Açılan"
          value={stats.opened}
          hint={`%${openRate} açılma oranı`}
          tone={stats.opened > 0 ? 'ok' : 'default'}
        />
        <StatCard label="Yanıt" value={stats.replies} />
        <StatCard label="Olumlu" value={stats.positive} tone="ok" hint="AI tarafından sınıflandırıldı" />
      </div>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold">Nasıl çalışır?</h2>
        <ol className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
          <li>
            <span className="font-medium text-[var(--color-ink)]">1. Keşfet</span> — bir prompt yazın
            (örn. &quot;İstanbul içi butik&quot;), n8n + SearXNG şirketleri ve iletişim bilgilerini
            bulsun.
          </li>
          <li>
            <span className="font-medium text-[var(--color-ink)]">2. Şirketler</span> — listeden
            seçim yapın, dilerseniz elle kayıt ekleyin.
          </li>
          <li>
            <span className="font-medium text-[var(--color-ink)]">3. Mail Yaz</span> — taslağınızı
            yazın, AI iyileştirsin, video önizlemesi ekleyip toplu gönderin.
          </li>
          <li>
            <span className="font-medium text-[var(--color-ink)]">4. Gelen Kutusu</span> — açılanlar
            yeşil, açılmayanlar kırmızı. Yanıtlardan yalnızca olumlu olanlar öne çıkar.
          </li>
        </ol>
      </Card>
    </>
  )
}
