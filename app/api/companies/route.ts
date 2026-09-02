import { db } from '@/lib/db'
import { normalizeDomain, isJunkEmail } from '@/lib/companies'
import type { Prisma } from '@/generated/prisma/client'

/** Sirket listesi — arama ve filtrelerle. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()
  const city = searchParams.get('city')?.trim()
  const sector = searchParams.get('sector')?.trim()
  const source = searchParams.get('source')?.trim()
  const onlyWithEmail = searchParams.get('withEmail') === '1'

  const where: Prisma.CompanyWhereInput = { isActive: true }

  if (q) {
    where.OR = [{ name: { contains: q } }, { domain: { contains: q } }, { email: { contains: q } }]
  }
  if (city) where.city = city
  if (sector) where.sector = sector
  if (source) where.source = source
  if (onlyWithEmail) where.email = { not: null }

  const [companies, cities, sectors] = await Promise.all([
    db.company.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 }),
    db.company.findMany({
      where: { isActive: true, city: { not: null } },
      select: { city: true },
      distinct: ['city'],
    }),
    db.company.findMany({
      where: { isActive: true, sector: { not: null } },
      select: { sector: true },
      distinct: ['sector'],
    }),
  ])

  return Response.json({
    companies,
    filters: {
      cities: cities.map((c) => c.city).filter(Boolean),
      sectors: sectors.map((s) => s.sector).filter(Boolean),
    },
  })
}

/** Elle sirket ekleme. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string
    email?: string
    phone?: string
    website?: string
    city?: string
    sector?: string
  }

  const name = body.name?.trim()
  if (!name) return Response.json({ error: 'Şirket adı zorunlu.' }, { status: 400 })

  const email = body.email?.trim().toLowerCase() || null
  if (email && isJunkEmail(email)) {
    return Response.json({ error: 'Geçerli bir e-posta adresi girin.' }, { status: 400 })
  }

  const domain = normalizeDomain(body.website || (email ? email.split('@')[1] : '') || '')

  if (domain) {
    const existing = await db.company.findUnique({ where: { domain } })
    if (existing) {
      return Response.json(
        { error: `Bu alan adı zaten kayıtlı: ${existing.name}` },
        { status: 409 },
      )
    }
  }

  const company = await db.company.create({
    data: {
      name,
      email,
      phone: body.phone?.trim() || null,
      website: body.website?.trim() || (domain ? `https://${domain}` : null),
      domain,
      city: body.city?.trim() || null,
      sector: body.sector?.trim() || null,
      source: 'manual',
    },
  })

  return Response.json(company, { status: 201 })
}

/** Toplu silme. */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: number[] }
  const ids = (body.ids ?? []).filter((id) => Number.isFinite(id))

  if (ids.length === 0) return Response.json({ error: 'Silinecek kayıt seçin.' }, { status: 400 })

  const result = await db.company.deleteMany({ where: { id: { in: ids } } })
  return Response.json({ deleted: result.count })
}
