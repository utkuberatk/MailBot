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

// n8n 'localhost'u once IPv6 (::1) olarak cozer; Docker portu ve next dev
// yalnizca IPv4 dinledigi icin adresi sabitle.
function toIPv4(url) {
  return String(url)
    .replace(/\\/+$/, '')
    .replace(/^(https?:\\/\\/)localhost(?=[:\\/]|$)/i, '$1127.0.0.1');
}

return queries.map((query) => ({
  json: {
    query,
    runId: body.runId,
    appUrl: toIPv4(body.appUrl || 'http://127.0.0.1:3000'),
    searxngUrl: toIPv4(body.searxngUrl || 'http://127.0.0.1:8080'),
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
const errors = [];
let resultTotal = 0;
const limit = meta.limit || 25;

// n8n Code node kum havuzunda URL sinifi yok; alan adini regex ile cikar.
function hostOf(value) {
  const match = String(value || '').match(/^https?:\\/\\/([^/?#]+)/i);
  if (!match) return '';
  return match[1].toLowerCase().replace(/^www\\./, '').replace(/:\\d+$/, '');
}

for (const item of $input.all()) {
  // SearXNG'e ulasilamazsa HTTP node hatayi item olarak gecirir
  // (onError: continueRegularOutput) — sebebi topla, sessizce yutma.
  if (item.json && item.json.error) {
    const err = item.json.error;
    errors.push(String((err && err.message) || err));
    continue;
  }

  const results = (item.json && item.json.results) || [];
  resultTotal += results.length;

  for (const result of results) {
    const host = hostOf(result.url);
    if (!host || !host.includes('.') || seen.has(host)) continue;
    if (blocked.some((b) => host === b || host.endsWith('.' + b))) continue;

    seen.add(host);
    out.push({
      json: {
        ok: true,
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

if (out.length > 0) return out;

// Aday yoksa zincir burada biterdi ve kayit "Calisiyor" olarak asili kalirdi.
// Bunun yerine "Aday Var mi" IF node'unu FALSE dalina sokan bir bitirme
// item'i uret; boylece sebep kullaniciya kadar ulasir.
const unique = [...new Set(errors)];
const reason = unique.length
  ? 'SearXNG sorgulari basarisiz oldu: ' + unique.join(' | ') +
    ' — SearXNG kapali olabilir: docker compose -f infra/docker-compose.yml up -d'
  : 'SearXNG ' + resultTotal + ' sonuc dondurdu ama hicbiri uygun sirket sitesi degildi ' +
    '(pazaryeri/sosyal medya elendi). Daha genel bir prompt deneyin.';

return [
  {
    json: { ok: false, runId: meta.runId, appUrl: meta.appUrl, status: 'FAILED', error: reason },
  },
];
`.trim()

const extractCode = `
// Ana sayfa + iletisim sayfasi HTML'inden e-posta, telefon ve metin cikar.
const candidates = $('Aday Siteleri Cikar').all();
const homepages = $('Ana Sayfayi Getir').all();
const contactPages = $input.all();

const junk = ['noreply','no-reply','donotreply','example.com','example.org','sentry.io','wixpress',
  'yourdomain','domain.com','.png','.jpg','.jpeg','.gif','.webp','.svg','@2x','yoursite',
  // Altyapi saglayicilarinin sablon adresleri — sirkete ait degil.
  'eticaretsitesi.com','ideasoft.com.tr','ticimax.com','ikas.com','shopify.com','wix.com',
  'platinmarket.com','projesoft.com.tr','tsoft.com.tr','sentry-next'];

// &amp; ve \\u003e gibi kacis dizilerini coz — regex bunlari e-postaya yapistirabiliyor.
function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\\\u00([0-9a-f]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Sayfa basligindan kullanilabilir bir sirket adi cikarir. */
function cleanTitle(value) {
  const title = decodeEntities(value)
    // Uzun tireleri sadelestir, sonra ayiricilara gore ilk parcayi al.
    .replace(/[\\u2013\\u2014]/g, '-')
    .replace(/\\s+/g, ' ')
    .trim();

  // "Marka | Slogan" veya "Marka - Slogan" kaliplarinda ilk anlamli parcayi al.
  const parts = title.split(/\\s*\\|\\s*|\\s+-\\s+/).map((p) => p.trim()).filter(Boolean);
  const name = parts.length > 1 && parts[0].length >= 3 ? parts[0] : title;

  return name.replace(/^[\\s|-]+|[\\s|-]+$/g, '').slice(0, 80);
}

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
  const emails = [...new Set((decodeEntities(html).match(EMAIL_RE) || []).map((e) => e.toLowerCase()))]
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
      ok: true,
      domain: base.domain,
      website: base.url,
      runId: base.runId,
      appUrl: base.appUrl,
      title: cleanTitle(titleMatch ? titleMatch[1] : base.title) || base.domain,
      email: emails[0] || null,
      allEmails: emails.slice(0, 5),
      phone: phones[0] || null,
      text: text.slice(0, 3000),
      snippet: base.snippet,
    },
  });
}

if (out.length > 0) return out;

// Hicbir siteden icerik alinamadi — kaydi acik birakmadan sebebi bildir.
const meta = candidates[0] ? candidates[0].json : {};

return [
  {
    json: {
      ok: false,
      runId: meta.runId,
      appUrl: meta.appUrl,
      status: 'FAILED',
      error:
        'Bulunan ' + candidates.length + ' sitenin hicbirine erisilemedi ' +
        '(zaman asimi, sertifika hatasi veya bot engeli). Farkli bir prompt deneyin.',
    },
  },
];
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
      ok: true,
      runId: first.runId,
      appUrl: first.appUrl,
      count: companies.length,
      companies,
    },
  },
];
`.trim()

const summaryCode = `
// Kayit adiminin sonucunu tek bir "bitirme" item'ina indirger.
const prepared = $('Kayitlari Hazirla').first().json;
const response = $input.first().json || {};

// HTTP node hatayi item olarak gecirir (onError: continueRegularOutput).
const failure = response.error ? String(response.error.message || response.error) : null;

return [
  {
    json: {
      runId: prepared.runId,
      appUrl: prepared.appUrl,
      status: failure ? 'FAILED' : 'DONE',
      error: failure ? 'Sirketler kaydedilemedi: ' + failure : null,
    },
  },
];
`.trim()

/** HTTP node icin JSON govde ifadesi. */
const jsonBody = (obj) => `=${obj}`

/**
 * "Devam edilsin mi?" dallanmasi.
 *
 * Code node'lari basarisizlikta tek bir `ok: false` item'i uretir; bu node
 * onu FALSE dalina, oradan da "Kesfi Bitir" adimina yollar. Boylece zincir
 * hangi adimda kopursa kopsun DiscoveryRun kapanir ve sebep UI'da gorunur.
 */
const ifNode = (name, id, position) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        {
          id: `${id}-ok`,
          leftValue: '={{ $json.ok === true }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  },
  id,
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position,
})

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
  ifNode('Aday Var mi', 'a1000000-0000-4000-8000-000000000013', [700, 0]),
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
    position: [920, -160],
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
    position: [1140, -160],
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: extractCode },
    id: 'a1000000-0000-4000-8000-000000000008',
    name: 'Iletisim Bilgisi Cikar',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1360, -160],
  },
  ifNode('Iletisim Var mi', 'a1000000-0000-4000-8000-000000000014', [1580, -160]),
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
    position: [1800, -280],
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: mergeCode },
    id: 'a1000000-0000-4000-8000-000000000010',
    name: 'Kayitlari Hazirla',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2020, -280],
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
    position: [2240, -280],
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: summaryCode },
    id: 'a1000000-0000-4000-8000-000000000015',
    name: 'Sonucu Ozetle',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2460, -280],
  },
  {
    // Basarili da olsa basarisiz da olsa buraya gelinir: kayit hep kapanir.
    parameters: {
      method: 'POST',
      url: '={{ $json.appUrl }}/api/n8n/runs/finish',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: jsonBody(
        "{{ JSON.stringify({ runId: $json.runId, status: $json.status || 'DONE', error: $json.error || null }) }}",
      ),
      options: { timeout: 30000 },
    },
    id: 'a1000000-0000-4000-8000-000000000012',
    name: 'Kesfi Bitir',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [2680, 0],
    onError: 'continueRegularOutput',
  },
]

/** main cikisindan (0 = true / 1 = false) hedef node'a baglanti. */
const to = (node) => [{ node, type: 'main', index: 0 }]

const connections = {
  Webhook: { main: [to('Sorgu Uret')] },
  'Sorgu Uret': { main: [to('Sorgulari Ayir')] },
  'Sorgulari Ayir': { main: [to('SearXNG Ara')] },
  'SearXNG Ara': { main: [to('Aday Siteleri Cikar')] },
  'Aday Siteleri Cikar': { main: [to('Aday Var mi')] },
  // Aday yoksa dogrudan bitirmeye git (kayit "Calisiyor" asili kalmasin).
  'Aday Var mi': { main: [to('Ana Sayfayi Getir'), to('Kesfi Bitir')] },
  'Ana Sayfayi Getir': { main: [to('Iletisim Sayfasini Getir')] },
  'Iletisim Sayfasini Getir': { main: [to('Iletisim Bilgisi Cikar')] },
  'Iletisim Bilgisi Cikar': { main: [to('Iletisim Var mi')] },
  'Iletisim Var mi': { main: [to('Sirketi Siniflandir'), to('Kesfi Bitir')] },
  'Sirketi Siniflandir': { main: [to('Kayitlari Hazirla')] },
  'Kayitlari Hazirla': { main: [to('Sirketleri Kaydet')] },
  'Sirketleri Kaydet': { main: [to('Sonucu Ozetle')] },
  'Sonucu Ozetle': { main: [to('Kesfi Bitir')] },
}

const workflow = {
  name: 'mailbot-discovery',
  active: true,
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  tags: [],
}

/**
 * Code node'larinin sozdizimini burada dogrula.
 *
 * Bu dosyada kod, sablon dizesi (`) icinde yaziliyor: `\/` gibi kacislar
 * derlenirken sadelesiyor ve bozuk kod n8n'e sessizce yuklenebiliyor.
 * Hatayi calisma aninda degil, uretim aninda gorelim.
 */
function assertCodeNodesParse(definition) {
  for (const node of definition.nodes) {
    if (node.type !== 'n8n-nodes-base.code') continue
    try {
      new Function(node.parameters.jsCode)
    } catch (error) {
      console.error(`\nHATA: "${node.name}" Code node'u derlenmiyor: ${error.message}`)
      console.error('Sablon dizesi icinde ters bolu kullandiysaniz iki kez yazin: \\\\/\n')
      process.exit(1)
    }
  }
}

assertCodeNodesParse(workflow)

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
