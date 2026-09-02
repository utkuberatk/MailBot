# MailBot

Verilen bir prompta göre e-ticaret şirketlerini bulan, iletişim bilgilerini çıkaran, seçilenlere Groq AI ile iyileştirilmiş soğuk mail gönderen, gelen yanıtları analiz edip sadece olumlu olanları önüne getiren ve tüm bunları Discord üzerinden de yönetilebilir kılan, **tamamen local ve ücretsiz** çalışan bir sistem.

---

## 1. Değişmez kurallar

1. **API hatırlatması:** Her görev bitiminde, kullanıcının elle eklemesi gereken yeni bir API anahtarı/secret varsa mesajın sonunda şunu yaz:
   `⚠️ Manuel olarak bu API'ları n8n otomasyonlarına eklemelisiniz / .env dosyasına eklemelisiniz: <liste>`
   Yeni secret gerekmiyorsa bu mesajı yazma.
2. **Git:** Her tamamlanan değişiklikten sonra commit + push → `https://github.com/utkuberatk/MailBot.git` (dal: `main`).
3. **Ücretsizlik:** Ücretli abonelik veya kredi kartı isteyen servis kullanılmaz. Yeni bağımlılık ücretsiz katmanda çalışmalı.
4. **Local:** Her şey kullanıcının makinesinde çalışır. Dış bağımlılık yalnızca Groq API, Gmail API ve (opsiyonel) video barındırma.
5. **Dil:** Kullanıcıyla iletişim Türkçe. Kod ve değişken isimleri İngilizce.
6. **Secret:** Anahtarlar sadece `.env` içinde. Koda gömme, commit etme, log'a yazma.
7. **Veri sınırı:** Veritabanına sadece Next.js uygulaması yazar. n8n ve Discord botu uygulamanın HTTP API'sini `X-Internal-Key` başlığıyla çağırır.
8. **Yıkıcı işlem:** n8n workflow silme, DB sıfırlama gibi geri dönüşü olmayan adımlarda önce yedek al, sonra kullanıcıdan onay iste.

---

## 2. Mimari

```
                 ┌───────────────┐
   Kullanıcı ───►│  Next.js UI   │  localhost:3000
                 │  + API routes │
                 └──────┬────────┘
                        │ Prisma
                 ┌──────▼────────┐
                 │ SQLite dev.db │
                 └──────▲────────┘
       ┌────────────────┼──────────────────┐
       │                │                  │
┌──────┴───────┐ ┌──────┴──────┐   ┌───────┴──────┐
│  n8n :5678   │ │  Groq API   │   │ Discord bot  │
│ discovery +  │ │ iyileştirme │   │ bildirim +   │
│ zamanlayıcı  │ │ + analiz    │   │ komutlar     │
└──────┬───────┘ └─────────────┘   └──────────────┘
       │
┌──────┴────────┐        ┌──────────────┐
│ SearXNG :8080 │        │  Gmail API   │
└───────────────┘        └──────────────┘
```

Gmail OAuth token'ı yalnızca Next.js tarafında durur; n8n ve bot mail göndermek için uygulamanın API'sini çağırır.

---

## 3. Teknoloji kararları

| Alan | Karar | Neden |
|---|---|---|
| Uygulama | Next.js 16 (App Router) + TypeScript + Tailwind 4 | Tek proje, tek port, UI + API birlikte |
| Veritabanı | SQLite + Prisma 7 (`better-sqlite3` driver adapter) | Kurulum gerektirmez, dosya bazlı, local |
| Arama | SearXNG (local Docker) | Ücretsiz, kotasız, API key yok |
| AI | Groq API (`openai/gpt-oss-120b`) | Ücretsiz katman, çok hızlı, JSON modu var |
| Mail | Gmail API (OAuth2, Desktop app) | Thread/message ID takibi, güvenilir yanıt eşleştirme |
| Otomasyon | n8n (localhost:5678) | Discovery hattı ve zamanlanmış görevler |
| Bot | discord.js v14, ayrı process | Uzaktan kontrol |
| Video | Thumbnail görsel + link | Attachment spam skorunu yükseltir |

---

## 4. Klasör yapısı

```
Mailbot/
├── CLAUDE.md              # bu dosya — yol haritası
├── README.md              # kısa kurulum özeti
├── .env.example           # tüm değişkenler (gerçek değerler .env'de)
├── app/                   # Next.js uygulaması (UI + API routes)
├── prisma/schema.prisma   # veri modeli
├── bot/                   # Discord botu (ayrı node process)
├── n8n/workflows/         # workflow JSON'ları (versiyonlanır)
│   └── _backup/           # silinmeden önce alınan eski workflow yedekleri
├── scripts/               # gmail-auth, n8n-sync, video-thumb yardımcıları
├── infra/                 # docker-compose (SearXNG) + servis ayarları
└── media/                 # video ve thumbnail dosyaları (git'e girmez)
```

---

## 5. Veri modeli

`prisma/schema.prisma` içinde tanımlı. Özet:

| Model | Görevi | Kritik alanlar |
|---|---|---|
| `Company` | Bulunan/eklenen şirket | `email`, `domain`, `source` (n8n/manual/csv), `isEcommerce`, `isActive` |
| `Campaign` | Mail şablonu + video | `subject`, `bodyTemplate`, `videoUrl`, `videoThumbPath` |
| `Message` | Gönderilen tek mail | `status`, `trackingId`, `sentAt`, `openedAt`, `gmailThreadId` |
| `Reply` | Gelen yanıt | `sentiment`, `sentimentScore`, `summary`, `discordNotifiedAt` |
| `DiscoveryRun` | Bir arama çalıştırması | `prompt`, `status`, `resultCount` |
| `Setting` | key/value ayarlar | gönderim limitleri, warm-up sayacı |

**Yeşil/kırmızı kuralı:** `Message.openedAt == null` → kırmızı, dolu → yeşil. Ayrı bir alan tutma.

---

## 6. Yol haritası

Fazlar sırayla yapılır. Bir faz, "Bitti" koşulu sağlanmadan kapatılmaz.

### ✅ Faz 0 — Skill kurulumu (tamamlandı)
- skills.sh üzerinden kurulanlar bölüm 13'te listeli.

### ✅ Faz 1 — Temel iskelet (tamamlandı)
- Next.js 16 + TypeScript + Tailwind 4, Prisma 7 + SQLite (`init` migration uygulandı).
- `lib/db.ts` (Prisma singleton + better-sqlite3 adapter), `lib/env.ts` (env erişimi).
- Sol menü + Panel + `/settings` (eksik anahtarları gösterir) + faz sayfaları için yer tutucular.
- **Bitti:** `npm run dev` → localhost:3000 çalışıyor, `npx next build` temiz geçiyor.

### ✅ Faz 2 — Altyapı servisleri (tamamlandı)
- SearXNG: `docker compose -f infra/docker-compose.yml up -d`, `format=json` doğrulandı.
- `scripts/n8n-sync.js`: `list` / `backup` / `purge --yes` / `push` / `reset --yes`.
- Eski 3 workflow (LeadBot 1-2-3) `n8n/workflows/_backup/` altına yedeklendi ve kullanıcı onayıyla silindi.

### ✅ Faz 3 — Discovery hattı (tamamlandı)
- `n8n/workflows/mailbot-discovery.json` (12 node) n8n'e yüklendi ve aktif.
- Akış: `Webhook` → app'ten arama sorguları → SearXNG → domain dedupe + pazaryeri/sosyal medya elemesi → ana sayfa + `/iletisim` çek → e-posta/telefon regex çıkarımı → app'ten sınıflandırma → `POST /api/n8n/companies` → `POST /api/n8n/runs/finish`.
- Workflow'ları elle düzenlemeyin: `npm run workflows` (üretici) → `npm run n8n:sync push`.
- **Servis adresleri n8n'e webhook gövdesiyle geçilir** (`appUrl`, `searxngUrl`) — n8n tarafında kimlik bilgisi/ayar tutmaya gerek yok. n8n Docker içindeyse `.env`'de bu adresleri `host.docker.internal` ile yazın.
- ✅ Uçtan uca doğrulandı: `İstanbul içi butik mağazalar` → 11 gerçek butik sitesi, 8'i e-postalı.
- **n8n Code node'larında `URL` sınıfı yoktur** — alan adı/host ayrıştırmasını regex ile yapın, aksi halde `try/catch` hatayı yutar ve node sessizce 0 sonuç döndürür.

### ✅ Faz 4 — Şirket yönetimi (tamamlandı)
- `/companies`: arama, şehir/sektör/e-posta filtreleri, çoklu seçim, toplu silme, seçilenlerle `/compose`'a geçiş.
- Elle ekleme (aynı alan adı varsa 409) + CSV içe aktarma (`,` ve `;` ayırıcı, TR/EN başlıklar, başlıksız dosyalarda sıralı eşleme).
- Uçlar: `/api/companies` (GET/POST/DELETE), `/api/companies/import`.

### ✅ Faz 5 — Mail yazma, iyileştirme, gönderim (tamamlandı)
- `lib/gmail.ts`: OAuth refresh, MIME kurulumu (text+html, RFC 2047 başlık kodlaması), gönderim, thread okuma.
- `lib/mailer.ts`: kuyruk, 45-90 sn rastgele gecikme, saatlik/günlük limit, warm-up (1. hafta 10, 2. hafta 25, sonra `.env`), kişiselleştirme kontrolü, bounce'ta `isActive=false`.
- `lib/video.ts`: YouTube/Vimeo kapak indirme + ffmpeg ile play butonlu önizleme (play butonu PNG'si saf Node ile üretilir, harici bağımlılık yok). ffmpeg yoksa kapak görseli butonsuz kullanılır.
- Uçlar: `/api/ai/improve`, `/api/messages` (liste + kuyruğu sürdür), `/api/messages/send`, `/api/track/[trackingId]`, `/api/unsubscribe/[trackingId]`, `/api/video/thumbnail`, `/media/[...file]`.
- `/compose`: taslak → "AI ile iyileştir" (spam skoru + uyarılar) → video önizleme → seçili şirketlere kuyruklu gönderim. Onaylanan metinde şirket adı `{{company}}` değişkenine geri çevrilir.
- **`PUBLIC_URL`:** takip pikseli ve görseller mailin içinden çağrıldığı için dışarıya açık bir adres gerekir (`cloudflared tunnel --url http://localhost:3000`). Boşsa `APP_URL` kullanılır ve açılma takibi çalışmaz.
- ✅ Uçtan uca doğrulandı: test maili gelen kutusuna düştü (spam'e değil), Türkçe karakterler ve `List-Unsubscribe` başlığı doğru; tünel üzerinden çağrılan piksel kaydı yeşile çevirdi; çıkış linki şirketi pasifleştirdi.
- ✅ ffmpeg ile play butonlu önizleme üretiliyor (ffmpeg PATH'te değilse `FFMPEG_PATH` ve winget klasörü de denenir).

### ✅ Faz 6 — Gelen kutusu + analiz (tamamlandı)
- `n8n/workflows/mailbot-inbox-sync.json` (3 dakikada bir) → `POST /api/jobs/sync-inbox`. n8n'e yüklendi ve aktif.
- `lib/inbox.ts`: son 30 günün thread'lerini tarar, alıntılanan metni ayıklar, `Reply` açar, Groq ile duygu analizi yapar; NEGATIVE gelen şirketi pasifleştirir.
- Uçlar: `/api/jobs/sync-inbox`, `/api/replies` (GET/PATCH), `/api/replies/[id]/answer`, `/api/stats`.
- `/inbox`: "Yanıtlar" sekmesinde **"Sadece OLUMLU" filtresi varsayılan açık**, kart içinden AI destekli yanıtlama; "Gönderilenler" sekmesinde yeşil/kırmızı nokta (`openedAt`).

### ✅ Faz 7 — Discord bot (tamamlandı)
- discord.js v14, `bot/` altında ayrı process: `index.js` (giriş + bildirim döngüsü), `api.js` (HTTP istemcisi), `commands.js` (komutlar).
- Sadece `DISCORD_OWNER_ID` komut çalıştırabilir. Bot DB'ye dokunmaz, sadece uygulamanın API'sini çağırır.
- Dakikada bir `/api/replies?sentiment=POSITIVE&notified=0` yoklanır → embed bildirim → `PATCH /api/replies` ile işaretlenir.
- ✅ Doğrulandı: bot giriş yapıyor, olumlu yanıt embed'i kanala düşüyor ve `discordNotifiedAt` işaretleniyor; `!mailcevap` akışı AI ile düzeltilmiş yanıtı thread'e gönderiyor.
- `DISCORD_CHANNEL_ID` bir **metin kanalı** ID'si olmalı (sunucu ID'si değil); yanlışsa bot erişebildiği kanalları listeler.

### ✅ Faz 8 — Teslimat & kısayol (tamamlandı)
- `scripts/MailBot.bat` şablonu + `npm run launcher` → masaüstüne mutlak yollu kopya yazar.
- Sırasıyla: SearXNG (Docker varsa) → n8n kontrolü → `npm run dev` → `npm run tunnel` → `npm run bot` → tarayıcı.
- Spam checklist'i bölüm 10'da; kuyruk, limitler, tek CTA, tek görsel, `List-Unsubscribe`, kişiselleştirme kontrolü ve bounce pasifleştirme uygulanmış durumda.

### ✅ Faz 9 — Sağlamlaştırma (tamamlandı)
- Groq serî kuyruğu + 429 retry (`lib/groq.ts`), n8n workflow JSON'ları repoda, README güncel.
- Keşif kaydı 10 dakika içinde bitmezse zaman aşımına uğrar (n8n çökerse UI sonsuza kadar dönmez).
- Yanıt gönderirken `In-Reply-To` başlığı okunamazsa gönderim yine yapılır (thread'e ekleme `threadId` ile çalışır).
- **Erişim kuralı:** `PUBLIC_URL` ile uygulama dışarı açıldığında iç uçlar `X-Internal-Key` olmadan çalışmaz; sadece `/api/track`, `/api/unsubscribe` ve `/media` dışarıdan erişilebilir.

---

## 7. API sözleşmeleri

Tüm iç endpoint'ler `X-Internal-Key: $APP_INTERNAL_API_KEY` ister.

| Endpoint | Çağıran | İş |
|---|---|---|
| `POST /api/discover` | UI, bot | `{ prompt }` → n8n webhook'unu tetikler, `DiscoveryRun` açar |
| `POST /api/n8n/companies` | n8n | `{ runId, companies: [...] }` → şirketleri kaydeder (domain'e göre upsert) |
| `POST /api/jobs/sync-inbox` | n8n | Gmail yanıtlarını çeker, analiz eder |
| `POST /api/messages/send` | UI | `{ campaignId, companyIds[] }` → kuyruğa alır |
| `GET  /api/track/[trackingId]` | mail istemcisi | 1x1 PNG, `openedAt` yazar |
| `GET  /api/replies?sentiment=POSITIVE` | UI, bot | Yanıt listesi |
| `POST /api/replies/[id]/answer` | bot, UI | `{ text }` → Groq ile düzeltir, thread'e yanıtlar |
| `GET  /api/stats` | bot | Gönderilen/açılan/yanıtlanan sayıları |

---

## 8. Groq sözleşmeleri (`lib/groq.ts`)

Tüm fonksiyonlar JSON döner; parse hatasında 1 kez retry, sonra hata.

| Fonksiyon | Girdi | Çıktı |
|---|---|---|
| `buildSearchQueries(prompt)` | kullanıcı promptu | `{ queries: string[] }` (3-5 adet, Türkçe arama sorgusu) |
| `classifyCompany(site)` | site metni | `{ isEcommerce: boolean, sector: string, city: string\|null, confidence: number }` |
| `improveEmail(draft, company)` | taslak + şirket bilgisi | `{ subject, body, spamScore, warnings[] }` — **niyeti ve tonu korur**, uydurma bilgi eklemez |
| `analyzeReply(text)` | yanıt metni | `{ sentiment: "POSITIVE"\|"NEUTRAL"\|"NEGATIVE", score: 0-1, summary: string }` |
| `polishReply(text, context)` | kullanıcının kısa yanıtı | `{ body }` — Gmail'den elle yazılmış gibi doğal, imzalı |

Model `.env`'deki `GROQ_MODEL` ile seçilir.

---

## 9. Discord komutları

| Komut | Örnek | Davranış |
|---|---|---|
| `!mailara` | `!mailara ['İstanbul İçi Butik']` | Discovery tetikler, bitince bulunan şirket sayısı + ilk 10 özet |
| `!mailcevap` | `!mailcevap 42 "Yarın 15:00 uygun"` | `polishReply` ile düzeltir → Gmail thread'ine yanıt → onay mesajı |
| `!durum` | `!durum` | Gönderilen / açılan / yanıtlanan / olumlu sayıları |

Bildirimler yalnızca `sentiment = POSITIVE` yanıtlar için gider.

---

## 10. Spam'e düşmeme kuralları

- [ ] Gönderim Gmail API üzerinden (SPF/DKIM/DMARC Google tarafından imzalanır).
- [ ] Mailler arası **45–90 sn rastgele** gecikme; saatlik ≤20, günlük ≤50.
- [ ] Warm-up: ilk hafta günlük 10, ikinci hafta 25, sonra 50.
- [ ] Sade HTML: tek CTA linki, en fazla 1 görsel (video thumbnail). **Attachment yok.**
- [ ] Kişiselleştirme zorunlu: şirket adı geçmeyen mail gönderilmez (gönderim öncesi kontrol).
- [ ] Gerçek imza + `List-Unsubscribe` başlığı + çalışan çıkış linki.
- [ ] Gönderim öncesi Groq spam taraması: çok sayıda ünlem, büyük harf blokları, "ücretsiz!!!", "hemen tıkla" → skor UI'da gösterilir, yüksekse uyarı.
- [ ] Hata/bounce alan adres otomatik `isActive = false`.

---

## 11. Ortam değişkenleri

Şablon: `.env.example`. Gerçek değerler `.env` içine yazılır (commit edilmez).

| Değişken | Nereden alınır | Zorunlu |
|---|---|---|
| `DATABASE_URL` | Sabit: `file:./dev.db` | ✅ |
| `APP_URL` | Sabit: `http://localhost:3000` | ✅ |
| `APP_INTERNAL_API_KEY` | Kendin üret (rastgele 32 karakter) | ✅ |
| `GROQ_API_KEY` | console.groq.com → API Keys | ✅ |
| `PUBLIC_URL` | `npm run tunnel` otomatik yazar. Boşsa açılma takibi ve mail görselleri çalışmaz | ➖ |
| `FFMPEG_PATH` / `CLOUDFLARED_PATH` | Araçlar PATH'te değilse tam yol (genelde gerekmez) | ➖ |
| `GROQ_MODEL` | Groq model listesinden (varsayılan: `openai/gpt-oss-120b`) | ✅ |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Google Cloud Console → OAuth (Desktop app) | ✅ |
| `GMAIL_REFRESH_TOKEN` | `node scripts/gmail-auth.js` üretir | ✅ |
| `GMAIL_USER` | Gönderim yapılacak Gmail adresi | ✅ |
| `SENDER_NAME` / `SENDER_TITLE` / `SENDER_ADDRESS` | Mail imzasında görünen ad, unvan, iletişim | ➖ |
| `N8N_BASE_URL` | Sabit: `http://localhost:5678` | ✅ |
| `N8N_API_KEY` | n8n → Settings → API → Create API key | ✅ |
| `N8N_WEBHOOK_DISCOVER_URL` | Faz 3'te workflow kurulunca oluşur | ✅ |
| `SEARXNG_URL` | Sabit: `http://localhost:8080` | ✅ |
| `DISCORD_BOT_TOKEN` | discord.com/developers → Bot → Token | ✅ |
| `DISCORD_CHANNEL_ID` | Discord'da geliştirici modu → kanal → ID kopyala | ✅ |
| `DISCORD_OWNER_ID` | Kendi Discord kullanıcı ID'in | ✅ |
| `VIDEO_BASE_URL` | Videoların servis edileceği adres | ➖ |
| `SEND_DAILY_LIMIT` / `SEND_HOURLY_LIMIT` | Varsayılan 50 / 20 | ➖ |

---

## 12. Komutlar

```bash
npm run dev            # Next.js geliştirme sunucusu (:3000)
npm run bot            # Discord botu
npm run db:migrate     # Prisma migration
npm run db:studio      # Veritabanını tarayıcıda görüntüle
npm run n8n:sync       # n8n/workflows içindeki JSON'ları n8n'e yükle (list/backup/purge/push/reset)
npm run workflows      # workflow JSON'larını üret (elle düzenlemeyin)
npm run gmail:auth     # Gmail refresh token üret
npm run launcher       # masaüstüne MailBot.bat kısayolu yaz
npm run tunnel         # cloudflared tüneli aç, PUBLIC_URL'i .env'ye yaz
docker compose -f infra/docker-compose.yml up -d   # SearXNG
```

---

## 13. Kurulu skill'ler

`.claude/skills/` altında (skills.sh üzerinden kuruldu):

| Skill | Kaynak | Ne için |
|---|---|---|
| `prisma-cli` | `prisma/skills` | Prisma 7 CLI komutları, migration akışı |
| `prisma-client-api` | `prisma/skills` | Prisma Client sorgu API'si, driver adapter kurulumu |
| `prisma-composer` | `prisma skills sync` | Kurulu Prisma sürümüyle otomatik senkron |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | React/Next.js performans kuralları |

Yeni skill kurmak için: `npx skills add <owner/repo> --skill <name> --agent claude-code`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
