/**
 * Basit CSV cozumleyici — tirnakli alanlari ve gomulu virgul/satir sonlarini destekler.
 * Ayirici olarak virgul veya noktali virgul otomatik secilir (Excel TR ; kullanir).
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const firstLine = text.split('\n', 1)[0] ?? ''
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field.trim())
      field = ''
    } else if (char === '\n') {
      row.push(field.trim())
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  row.push(field.trim())
  if (row.some((value) => value !== '')) rows.push(row)

  return rows
}

/** Basliktaki Turkce/Ingilizce sutun adlarini alan adlarina esler. */
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'sirket', 'şirket', 'firma', 'unvan', 'unvani', 'company', 'ad', 'isim'],
  email: ['email', 'e-posta', 'eposta', 'mail', 'e-mail', 'mail adresi'],
  phone: ['phone', 'telefon', 'tel', 'gsm', 'cep'],
  website: ['website', 'site', 'web', 'url', 'domain', 'alan adi', 'alan adı'],
  city: ['city', 'sehir', 'şehir', 'il'],
  sector: ['sector', 'sektor', 'sektör', 'kategori', 'alan'],
}

export type CsvCompany = {
  name?: string
  email?: string
  phone?: string
  website?: string
  city?: string
  sector?: string
}

/**
 * CSV satirlarini sirket kayitlarina cevirir.
 * Baslik satiri yoksa sutunlar sirasiyla: ad, e-posta, web, telefon, sehir, sektor.
 */
export function csvToCompanies(rows: string[][]): CsvCompany[] {
  if (rows.length === 0) return []

  const header = rows[0].map((cell) => cell.toLowerCase().trim())
  const mapping: Record<number, keyof CsvCompany> = {}
  let matched = 0

  header.forEach((cell, index) => {
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(cell)) {
        mapping[index] = field as keyof CsvCompany
        matched++
        break
      }
    }
  })

  const hasHeader = matched >= 2
  const dataRows = hasHeader ? rows.slice(1) : rows
  const fallback: (keyof CsvCompany)[] = ['name', 'email', 'website', 'phone', 'city', 'sector']

  return dataRows.map((cells) => {
    const company: CsvCompany = {}
    cells.forEach((value, index) => {
      const field = hasHeader ? mapping[index] : fallback[index]
      if (field && value) company[field] = value
    })
    return company
  })
}
