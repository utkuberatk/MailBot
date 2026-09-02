import { PageHeader, ComingSoon } from '@/components/ui'

export default function InboxPage() {
  return (
    <>
      <PageHeader
        title="Gelen Kutusu"
        description="Açılan mailler yeşil, açılmayanlar kırmızı. Yanıtlarda varsayılan olarak yalnızca olumlu olanlar listelenir."
      />
      <ComingSoon phase="Faz 6 (yanıt analizi)" />
    </>
  )
}
