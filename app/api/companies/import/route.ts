import { parseCsv, csvToCompanies } from '@/lib/csv'
import { upsertCompanies, normalizeDomain } from '@/lib/companies'

/**
 * CSV ile toplu sirket ekleme.
 * Govde: { csv: "..." } veya dogrudan text/csv icerigi.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  let csv = ''
  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as { csv?: string }
    csv = body.csv ?? ''
  } else {
    csv = await request.text()
  }

  if (!csv.trim()) return Response.json({ error: 'CSV içeriği boş.' }, { status: 400 })

  const rows = csvToCompanies(parseCsv(csv))
  if (rows.length === 0) return Response.json({ error: 'CSV içinde satır bulunamadı.' }, { status: 400 })

  // Alan adi olmayan satirlar e-postadan turetilir; ikisi de yoksa atlanir.
  const companies = rows.map((row) => ({
    ...row,
    domain: normalizeDomain(row.website || (row.email ? row.email.split('@')[1] : '') || '') ?? undefined,
  }))

  const result = await upsertCompanies(companies, { source: 'csv' })
  return Response.json({ ...result, total: rows.length })
}
