import { PageHeader, ComingSoon } from '@/components/ui'

export default function CompaniesPage() {
  return (
    <>
      <PageHeader
        title="Şirketler"
        description="Bulunan ve elle eklenen tüm şirketler. Mail göndermek için buradan seçim yaparsınız."
      />
      <ComingSoon phase="Faz 4 (şirket yönetimi)" />
    </>
  )
}
