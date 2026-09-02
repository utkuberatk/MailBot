import { PageHeader, ComingSoon } from '@/components/ui'

export default function ComposePage() {
  return (
    <>
      <PageHeader
        title="Mail Yaz"
        description="Taslağınızı yazın, AI iyileştirsin, video önizlemesi ekleyip seçili şirketlere gönderin."
      />
      <ComingSoon phase="Faz 5 (mail gönderimi)" />
    </>
  )
}
