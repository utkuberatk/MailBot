// n8n workflow ureticisi — mailbot-discovery ve mailbot-inbox-sync.
// Workflow JSON'larini elle duzenlemeyin; bu dosyayi duzenleyip yeniden calistirin.
require('dotenv/config')
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.resolve(__dirname, '..', 'n8n', 'workflows', 'mailbot-discovery.json')
const OUT_INBOX = path.resolve(__dirname, '..', 'n8n', 'workflows', 'mailbot-inbox-sync.json')

// Zamanlanmis workflow'da webhook govdesi olmadigi icin adres derleme aninda gomulur.
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

const splitQueriesCode = `
// Webhook govdesindeki bilgileri her sorguya tasi.
const body = $('Webhook').first().json.body || {};
const queries = $input.first().json.queries || [];

return queries.map((query) => ({
  json: {
    query,
    runId: body.runId,
    appUrl: (body.appUrl || 'http://localhost:3000').replace(/\\/$/, ''),
    searxngUrl: (body.searxngUrl || 'http://localhost:8080').replace(/\\/$/, ''),
    limit: body.limit || 25,
  },
}));
`.trim()

const candidatesCode = `
// Arama sonuclarini alan adina gore tekillestir, pazaryeri/sosyal medyayi ele.
const meta = $('Sorgulari Ayir').first().json;
const blocked = [
  'trendyol.com','hepsiburada.com','n11.com','amazon.com','amazon.com.tr','ciceksepeti.com',
  'gittigidiyor.com','sahibinden.com','dolap.com','letgo.com','instagram.com','facebook.com',
  'twitter.com','x.com','linkedin.com','pinterest.com','youtube.com','tiktok.com','wikipedia.org',
  'google.com','blogspot.com','wordpress.com','medium.com','shopify.com','ikas.com',
  'ideasoft.com.tr','ticimax.com','etsy.com','eksisozluk.com','sikayetvar.com','hurriyet.com.tr',
  'milliyet.com.tr','sozcu.com.tr','webrazzi.com','yemeksepeti.com','getir.com',
];

const seen = new Set();
const out = [];
const limit = meta.limit || 25;

for (const item of $input.all()) {
  for (const result of item.json.results || []) {
    let host;
    try {
      host = new URL(result.url).hostname.toLowerCase().replace(/^www\\./, '');
    } catch {
      continue;
    }
    if (!host || seen.has(host)) continue;
    if (blocked.some((b) => host === b || host.endsWith('.' + b))) continue;

    seen.add(host);
    out.push({
      json: {
        domain: host,
        url: 'https://' + host + '/',
        title: result.title || '',
        snippet: result.content || '',
        runId: meta.runId,
        appUrl: meta.appUrl,
      },
    });
    if (out.length >= limit) return out;
  }
}

return out;
`.trim()

const extractCode = `
// Ana sayfa + iletisim sayfasi HTML'inden e-posta, telefon ve metin cikar.
const candidates = $('Aday Siteleri Cikar').all();
const homepages = $('Ana Sayfayi Getir').all();
const contactPages = $input.all();

const junk = ['noreply','no-reply','donotreply','example.com','example.org','sentry.io','wixpress',
  'yourdomain','domain.com','.png','.jpg','.jpeg','.gif','.webp','.svg','@2x','yoursite'];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\\+90|0)[\\s(]*\\d{3}[\\s)]*\\d{3}[\\s.-]*\\d{2}[\\s.-]*\\d{2}/g;

function htmlOf(entry) {
  if (!entry) return '';
  const value = entry.json && entry.json.data;
  return typeof value === 'string' ? value : '';
}

function toText(html) {
  return html
    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

const out = [];

for (let i = 0; i < candidates.length; i++) {
  const base = candidates[i].json;
  const html = htmlOf(homepages[i]) + ' ' + htmlOf(contactPages[i]);
  if (!html.trim()) continue;

  const text = toText(html);

  // E-posta: once alan adiyla eslesenler.
  const emails = [...new Set((html.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))]
    .filter((e) => !junk.some((j) => e.includes(j)))
    .sort((a, b) => {
      const aOwn = a.endsWith('@' + base.domain) ? 0 : 1;
      const bOwn = b.endsWith('@' + base.domain) ? 0 : 1;
      return aOwn - bOwn;
    });

  const phones = [...new Set((text.match(PHONE_RE) || []).map((p) => p.replace(/\\s+/g, ' ').trim()))];

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\\/title>/i);

  out.push({
    json: {
      domain: base.domain,
      website: base.url,
      runId: base.runId,
      appUrl: base.appUrl,
      title: (titleMatch ? titleMatch[1] : base.title).trim().slice(0, 200),
      email: emails[0] || null,
      allEmails: emails.slice(0, 5),
      phone: phones[0] || null,
      text: text.slice(0, 3000),
      snippet: base.snippet,
    },
  });
}

return out;
`.trim()

const mergeCode = `
// Siniflandirma sonucunu iletisim bilgisiyle birlestir, kayit listesini hazirla.
const extracted = $('Iletisim Bilgisi Cikar').all();
const classified = $input.all();

const companies = [];

for (let i = 0; i < extracted.length; i++) {
  const info = extracted[i].json;
  const ai = (classified[i] && classified[i].json) || {};

  // E-ticaret olmadigi net olan siteleri listeye alma.
  if (ai.isEcommerce === false) continue;

  companies.push({
    name: ai.name || info.title || info.domain,
    domain: info.domain,
    website: info.website,
    email: info.email,
    phone: info.phone,
    city: ai.city || null,
    sector: ai.sector || null,
    score: typeof ai.confidence === 'number' ? ai.confidence : null,
    isEcommerce: ai.isEcommerce !== false,
    rawSnippet: (info.snippet || info.text || '').slice(0, 500),
  });
}

const first = extracted[0] ? extracted[0].json : {};

return [
  {
    json: {
      runId: first.runId,
      appUrl: first.appUrl,
      count: companies.length,
      companies,
    },
  },
];
`.trim()

/** HTTP node icin JSON govde ifadesi. */
const jsonBody = (obj) => `=${obj}`

const nodes = [
  {
    parameters: {
      httpMethod: 'POST',
      path: 'mailbot-discovery',
      // Kesif dakikalar surebilir; app beklemeden yanit alip durumu yoklar.
        responseMode: 'onReceived',
      options: {},
    },
    id: 'a1000000-0000-4000-8000-000000000001',
    name: 'Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [-400, 0],
    webhookId: 'mailbot-discovery',
  },
  {
    parameters: {
      method: 'POST',
      url: '={{ $json.body.appUrl }}/api/ai/queries',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: jsonBody('{{ JSON.stringify({ prompt: $json.body.prompt }) }}'),
      options: { timeout: 60000 },
    },
    id: 'a1000000-0000-4000-8000-000000000002',
    name: 'Sorgu Uret',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [-180, 0],
  },
  {
    parameters: { jsCode: splitQueriesCode },
    id: 'a1000000-0000-4000-8000-000000000003',
    name: 'Sorgulari Ayir',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [40, 0],
  },
  {
    parameters: {
      url: '={{ $json.searxngUrl }}/search',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'q', value: '={{ $json.query }}' },
          { name: 'format', value: 'json' },
          { name: 'language', value: 'tr-TR' },
        ],
      },
      options: { timeout: 30000 },
    },
    id: 'a1000000-0000-4000-8000-000000000004',
    name: 'SearXNG Ara',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [260, 0],
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: candidatesCode },
    id: 'a1000000-0000-4000-8000-000000000005',
    name: 'Aday Siteleri Cikar',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [480, 0],
  },
  {
    parameters: {
      url: '={{ $json.url }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: UA }] },
      options: {
        timeout: 15000,
        redirect: { redirect: { followRedirects: true } },
        response: { response: { responseFormat: 'text', neverError: true } },
      },
    },
    id: 'a1000000-0000-4000-8000-000000000006',
    name: 'Ana Sayfayi Getir',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [700, 0],
    onError: 'continueRegularOutput',
  },
  {
    parameters: {
      url: "={{ $('Aday Siteleri Cikar').item.json.url }}iletisim",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: UA }] },
      options: {
        timeout: 15000,
        redirect: { redirect: { followRedirects: true } },
        response: { response: { responseFormat: 'text', neverError: true } },
      },
    },
    id: 'a1000000-0000-4000-8000-000000000007',
    name: 'Iletisim Sayfasini Getir',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [920, 0],
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: extractCode },
    id: 'a1000000-0000-4000-8000-000000000008',
    name: 'Iletisim Bilgisi Cikar',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1140, 0],
  },
  {
    parameters: {
      method: 'POST',
      url: '={{ $json.appUrl }}/api/ai/classify',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: jsonBody(
        '{{ JSON.stringify({ domain: $json.domain, title: $json.title, text: $json.text }) }}',
      ),
      options: { timeout: 60000 },
    },
    id: 'a1000000-0000-4000-8000-000000000009',
    name: 'Sirketi Siniflandir',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1360, 0],
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: mergeCode },
    id: 'a1000000-0000-4000-8000-000000000010',
    name: 'Kayitlari Hazirla',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1580, 0],
  },
  {
    parameters: {
      method: 'POST',
      url: '={{ $json.appUrl }}/api/n8n/companies',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: jsonBody(
        '{{ JSON.stringify({ runId: $json.runId, companies: $json.companies }) }}',
      ),
      options: { timeout: 60000 },
    },
    id: 'a1000000-0000-4000-8000-000000000011',
    name: 'Sirketleri Kaydet',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1800, 0],
    onError: 'continueRegularOutput',
  },
  {
    parameters: {
      method: 'POST',
      url: "={{ $('Kayitlari Hazirla').first().json.appUrl }}/api/n8n/runs/finish",
      sendBody: true,
      specifyBody: 'json',
      jsonBody: jsonBody(
        "{{ JSON.stringify({ runId: $('Kayitlari Hazirla').first().json.runId, status: 'DONE' }) }}",
      ),
      options: { timeout: 30000 },
    },
    id: 'a1000000-0000-4000-8000-000000000012',
    name: 'Kesfi Bitir',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [2020, 0],
    onError: 'continueRegularOutput',
  },
]

const order = nodes.map((n) => n.name)
const connections = {}
for (let i = 0; i < order.length - 1; i++) {
  connections[order[i]] = { main: [[{ node: order[i + 1], type: 'main', index: 0 }]] }
}

const workflow = {
  name: 'mailbot-discovery',
  active: true,
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  tags: [],
}

fs.writeFileSync(OUT, JSON.stringify(workflow, null, 2) + '\n', 'utf8')
console.log(`yazildi: ${OUT} (${nodes.length} node)`)

// --- mailbot-inbox-sync: 3 dakikada bir Gmail yanitlarini cek --------------

const inboxWorkflow = {
  name: 'mailbot-inbox-sync',
  active: true,
  nodes: [
    {
      parameters: {
        rule: { interval: [{ field: 'minutes', minutesInterval: 3 }] },
      },
      id: 'b1000000-0000-4000-8000-000000000001',
      name: 'Her 3 Dakikada',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [0, 0],
    },
    {
      parameters: {
        method: 'POST',
        url: `${APP_URL}/api/jobs/sync-inbox`,
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '{}',
        options: { timeout: 120000 },
      },
      id: 'b1000000-0000-4000-8000-000000000002',
      name: 'Yanitlari Senkronize Et',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [240, 0],
      onError: 'continueRegularOutput',
    },
  ],
  connections: {
    'Her 3 Dakikada': {
      main: [[{ node: 'Yanitlari Senkronize Et', type: 'main', index: 0 }]],
    },
  },
  settings: { executionOrder: 'v1' },
  tags: [],
}

fs.writeFileSync(OUT_INBOX, JSON.stringify(inboxWorkflow, null, 2) + String.fromCharCode(10), 'utf8')
console.log(`yazildi: ${OUT_INBOX} (${inboxWorkflow.nodes.length} node)`)
