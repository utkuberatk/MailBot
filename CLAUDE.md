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
| AI | Groq API | Ücretsiz katman, çok hızlı |
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

### 🔶 Faz 2 — Altyapı servisleri (SearXNG bitti, n8n temizliği anahtar bekliyor)
- ✅ SearXNG çalışıyor: `docker compose -f infra/docker-compose.yml up -d`, `format=json` doğrulandı.
- ✅ `scripts/n8n-sync.js` yazıldı: `list` / `backup` / `purge --yes` / `push` / `reset --yes`.
- ⏳ Kullanıcı `.env`'ye `N8N_API_KEY` ekleyince çalıştır: `node scripts/n8n-sync.js backup` → listeyi kullanıcıya göster → onay al → `node scripts/n8n-sync.js purge --yes`.
- **Bitti:** Eski workflow'lar yedeklendi ve silindi.

### 🔶 Faz 3 — Discovery hattı (kod hazır, anahtar bekliyor)
- ✅ `n8n/workflows/mailbot-discovery.json` (12 node) yazıldı. Üreteci: `node scripts/build-workflows.js` — workflow'u elle düzenlemeyin, üreteci düzenleyip yeniden çalıştırın.
- ✅ Akış: `Webhook` → app'ten arama sorguları → SearXNG → domain dedupe + pazaryeri/sosyal medya elemesi → ana sayfa + `/iletisim` çek → e-posta/telefon regex çıkarımı → app'ten sınıflandırma → `POST /api/n8n/companies` → `POST /api/n8n/runs/finish`.
- ✅ App uçları: `/api/discover`, `/api/discover/runs`, `/api/ai/queries`, `/api/ai/classify`, `/api/n8n/companies`, `/api/n8n/runs/finish`. `/discover` sayfası prompt + canlı durum + sonuç tablosu.
- **Servis adresleri n8n'e webhook gövdesiyle geçilir** (`appUrl`, `searxngUrl`) — n8n tarafında kimlik bilgisi/ayar tutmaya gerek yok. n8n Docker içindeyse `.env`'de bu adresleri `host.docker.internal` ile yazın.
- ⏳ Kalan: `N8N_API_KEY` + `GROQ_API_KEY` geldiğinde `node scripts/n8n-sync.js push` → `/discover` üzerinden uçtan uca dene.
- **Bitti:** UI'dan prompt girilince şirketler iletişim bilgileriyle tabloya düşüyor.

### Faz 4 — Şirket yönetimi
- `/companies`: liste, arama/filtre (şehir, sektör, kaynak), çoklu seçim, silme.
- Manuel şirket ekleme formu + CSV içe aktarma.
- **Bitti:** Manuel eklenen kayıt listede görünüyor ve mail için seçilebiliyor.

### Faz 5 — Mail yazma, iyileştirme, gönderim
- `node scripts/gmail-auth.js` → tarayıcıda onay → refresh token `.env`'ye yazılır.
- `/compose`: taslak yaz → **"AI ile iyileştir"** (Groq; kullanıcının niyetini ve tonunu korur, sadece dili/akışı düzeltir) → video linki gir → ffmpeg ile play butonlu thumbnail üret → seçili şirketlere kuyruklu gönderim.
- Tracking pixel: `/api/track/[trackingId]` → 1x1 PNG döner, `openedAt` yazar.
- Gönderim kuyruğu bölüm 10'daki hız limitlerine uyar.
- **Bitti:** Test adrese mail gidiyor; mail açılınca kayıt yeşile dönüyor.

### Faz 6 — Gelen kutusu + analiz
- n8n workflow **`mailbot-inbox-sync`** (3 dakikada bir) → `POST /api/jobs/sync-inbox`.
- Uygulama Gmail'den thread yanıtlarını çeker, `Reply` kaydı açar, Groq ile duygu analizi yapar.
- `/inbox`: gönderilen mailler yeşil/kırmızı rozetle; **"Sadece OLUMLU" filtresi varsayılan açık**.
- **Bitti:** Gelen yanıt otomatik sınıflandırılıp doğru renkle listede.

### Faz 7 — Discord bot
- discord.js v14, `bot/` altında ayrı process. Sadece `DISCORD_OWNER_ID` komut çalıştırabilir.
- Yeni **POZİTİF** yanıt → belirlenen kanala embed bildirim (şirket, özet, mail ID).
- Komutlar bölüm 9'da.
- **Bitti:** Discord'dan gönderilen yanıt gerçekten karşı tarafın mailine düşüyor.

### Faz 8 — Teslimat & kısayol
- Bölüm 10 spam checklist'i uygulanır ve doğrulanır.
- `MailBot.bat` üretilir ve masaüstüne kopyalanır: SearXNG kontrolü → Next.js → Discord botu → tarayıcı açılır.
- **Bitti:** Masaüstündeki `.bat` tek tıkla sistemi ayağa kaldırıyor.

### Faz 9 — Sağlamlaştırma
- Groq rate-limit kuyruğu (ücretsiz katman ~30 istek/dk), hata yakalama, retry.
- n8n workflow JSON'ları `n8n/workflows/` altına export edilir.
- README güncellenir.

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
| `GROQ_MODEL` | Groq model listesinden (varsayılan: `llama-3.3-70b-versatile`) | ✅ |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Google Cloud Console → OAuth (Desktop app) | ✅ |
| `GMAIL_REFRESH_TOKEN` | `node scripts/gmail-auth.js` üretir | ✅ |
| `GMAIL_USER` | Gönderim yapılacak Gmail adresi | ✅ |
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
npm run n8n:sync       # n8n/workflows içindeki JSON'ları n8n'e yükle
npm run gmail:auth     # Gmail refresh token üret
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
