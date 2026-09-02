#!/usr/bin/env node
/**
 * n8n workflow yonetimi.
 *
 *   node scripts/n8n-sync.js list           mevcut workflow'lari listeler
 *   node scripts/n8n-sync.js backup         hepsini n8n/workflows/_backup/ altina kaydeder
 *   node scripts/n8n-sync.js purge --yes    hepsini siler (once otomatik yedek alir)
 *   node scripts/n8n-sync.js push           n8n/workflows/*.json dosyalarini yukler
 *   node scripts/n8n-sync.js reset --yes    backup + purge + push (tek komutta yenileme)
 *
 * Gerekli: .env icinde N8N_BASE_URL ve N8N_API_KEY
 */

require('dotenv/config')

const fs = require('node:fs')
const path = require('node:path')

const BASE_URL = (process.env.N8N_BASE_URL || 'http://localhost:5678').replace(/\/$/, '')
const API_KEY = process.env.N8N_API_KEY || ''
const ROOT = path.resolve(__dirname, '..')
const WORKFLOW_DIR = path.join(ROOT, 'n8n', 'workflows')
const BACKUP_DIR = path.join(WORKFLOW_DIR, '_backup')

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

async function api(pathname, options = {}) {
  if (!API_KEY) {
    fail(
      'N8N_API_KEY tanimli degil.\n' +
        '  n8n arayuzunde: Settings → n8n API → Create an API key\n' +
        '  Ardindan anahtari .env dosyasindaki N8N_API_KEY alanina yazin.',
    )
  }

  let response
  try {
    response = await fetch(`${BASE_URL}/api/v1${pathname}`, {
      ...options,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    fail(`n8n'e baglanilamadi (${BASE_URL}). n8n calisiyor mu?\n  ${error.message}`)
  }

  if (response.status === 401) fail('n8n API anahtari gecersiz. .env icindeki N8N_API_KEY dogru mu?')
  if (!response.ok) fail(`n8n API hatasi ${response.status}: ${await response.text()}`)
  if (response.status === 204) return null
  return response.json()
}

/** Dosya adinda kullanilamayan karakterleri temizler. */
function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

async function listWorkflows() {
  const data = await api('/workflows?limit=250')
  return data.data || []
}

async function cmdList() {
  const workflows = await listWorkflows()
  if (workflows.length === 0) {
    console.log('n8n bos — kayitli workflow yok.')
    return
  }
  console.log(`${workflows.length} workflow:\n`)
  for (const wf of workflows) {
    console.log(`  ${wf.active ? '●' : '○'} ${wf.id}  ${wf.name}`)
  }
  console.log('\n  ● aktif   ○ pasif')
}

async function cmdBackup() {
  const workflows = await listWorkflows()
  if (workflows.length === 0) {
    console.log('Yedeklenecek workflow yok.')
    return []
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)

  for (const wf of workflows) {
    const full = await api(`/workflows/${wf.id}`)
    const file = path.join(BACKUP_DIR, `${stamp}_${slug(wf.name)}_${wf.id}.json`)
    fs.writeFileSync(file, JSON.stringify(full, null, 2), 'utf8')
    console.log(`  ✓ ${wf.name} → ${path.relative(ROOT, file)}`)
  }

  console.log(`\n${workflows.length} workflow yedeklendi.`)
  return workflows
}

async function cmdPurge(confirmed) {
  const workflows = await listWorkflows()
  if (workflows.length === 0) {
    console.log('Silinecek workflow yok.')
    return
  }

  if (!confirmed) {
    console.log(`\n${workflows.length} workflow SILINECEK:\n`)
    for (const wf of workflows) console.log(`  - ${wf.name} (${wf.id})`)
    console.log('\nOnaylamak icin: node scripts/n8n-sync.js purge --yes\n')
    return
  }

  console.log('Once yedek aliniyor...')
  await cmdBackup()

  console.log('\nSiliniyor...')
  for (const wf of workflows) {
    await api(`/workflows/${wf.id}`, { method: 'DELETE' })
    console.log(`  ✓ silindi: ${wf.name}`)
  }
  console.log(`\n${workflows.length} workflow silindi. Yedekler: n8n/workflows/_backup/`)
}

async function cmdPush() {
  if (!fs.existsSync(WORKFLOW_DIR)) fail(`Klasor yok: ${WORKFLOW_DIR}`)

  const files = fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()

  if (files.length === 0) {
    console.log('n8n/workflows/ icinde yuklenecek JSON yok.')
    return
  }

  const existing = await listWorkflows()
  const byName = new Map(existing.map((wf) => [wf.name, wf]))

  for (const file of files) {
    const definition = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8'))

    // n8n API'si sadece bu alanlari kabul eder; id/tags/aktiflik gonderilmez.
    const payload = {
      name: definition.name,
      nodes: definition.nodes,
      connections: definition.connections,
      settings: definition.settings || { executionOrder: 'v1' },
    }

    const current = byName.get(definition.name)
    if (current) {
      await api(`/workflows/${current.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      console.log(`  ✓ guncellendi: ${definition.name}`)
      if (definition.active) await api(`/workflows/${current.id}/activate`, { method: 'POST' })
    } else {
      const created = await api('/workflows', { method: 'POST', body: JSON.stringify(payload) })
      console.log(`  ✓ olusturuldu: ${definition.name} (${created.id})`)
      if (definition.active) await api(`/workflows/${created.id}/activate`, { method: 'POST' })
    }
  }

  console.log(`\n${files.length} workflow yuklendi.`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const confirmed = args.includes('--yes')

  switch (command) {
    case 'list':
      return cmdList()
    case 'backup':
      return cmdBackup()
    case 'purge':
      return cmdPurge(confirmed)
    case 'push':
      return cmdPush()
    case 'reset':
      if (!confirmed) {
        console.log('\nBu komut TUM mevcut workflow\'lari silip yenilerini yukler.')
        console.log('Onaylamak icin: node scripts/n8n-sync.js reset --yes\n')
        return
      }
      await cmdPurge(true)
      return cmdPush()
    default:
      console.log(
        [
          '',
          'Kullanim: node scripts/n8n-sync.js <komut>',
          '',
          '  list            mevcut workflow\'lari listeler',
          '  backup          hepsini n8n/workflows/_backup/ altina kaydeder',
          '  purge --yes     hepsini siler (once yedek alir)',
          '  push            n8n/workflows/*.json dosyalarini yukler',
          '  reset --yes     backup + purge + push',
          '',
        ].join('\n'),
      )
  }
}

main().catch((error) => fail(error.stack || error.message))
