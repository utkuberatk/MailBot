# MailBot

Verdiğiniz prompta göre e-ticaret şirketlerini bulan, iletişim bilgilerini çıkaran, seçtiklerinize
Groq AI ile iyileştirilmiş soğuk mail gönderen, gelen yanıtları analiz edip sadece olumlu olanları
önünüze getiren ve tüm bunları Discord'dan da yönetebildiğiniz, **tamamen local ve ücretsiz**
çalışan bir sistem.

Ayrıntılı yol haritası ve mimari: [CLAUDE.md](CLAUDE.md)

---

## Hızlı kurulum

```bash
npm install
cp .env.example .env          # sonra .env içindeki anahtarları doldurun
npm run db:migrate            # SQLite veritabanını oluşturur
npm run gmail:auth            # Gmail refresh token üretir (tarayıcıda onay ister)
docker compose -f infra/docker-compose.yml up -d   # SearXNG
npm run workflows             # n8n workflow JSON'larını üretir
npm run n8n:sync push         # n8n'e yükler
npm run launcher              # masaüstüne MailBot.bat kısayolu yazar
```

Günlük kullanım için masaüstündeki **MailBot.bat** yeterli: SearXNG + Next.js + Discord botunu
başlatır ve tarayıcıyı açar.

---

## Gerekli anahtarlar

| Anahtar | Nereden |
|---|---|
| `GROQ_API_KEY` | console.groq.com → API Keys |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Google Cloud Console → OAuth client ID → **Desktop app** |
| `GMAIL_REFRESH_TOKEN` / `GMAIL_USER` | `npm run gmail:auth` otomatik yazar |
| `N8N_API_KEY` | n8n → Settings → n8n API |
| `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID` / `DISCORD_OWNER_ID` | discord.com/developers |
| `PUBLIC_URL` | Açılma takibi için dışa açık adres (opsiyonel, aşağıya bakın) |

Google Cloud projesinde **Gmail API'yi etkinleştirmeyi** unutmayın; Discord Developer Portal'da
**MESSAGE CONTENT INTENT** açık olmalı.

### Açılma takibi (`PUBLIC_URL`)

Takip pikseli ve video önizlemesi mailin içinden çağrılır; alıcının mail istemcisi `localhost`
adresine ulaşamaz. Ücretsiz bir tünel açıp adresini `.env`'ye yazın:

```bash
cloudflared tunnel --url http://localhost:3000
# çıkan https://... adresini PUBLIC_URL olarak .env'ye yazın
```

`PUBLIC_URL` boşken sistem çalışır ama hiçbir mail "açıldı" (yeşil) görünmez.

---

## Kullanım

1. **Keşfet** — prompt yazın (örn. *İstanbul içi butik mağazalar*), n8n arama yapıp iletişim
   bilgileriyle şirketleri tabloya düşürür.
2. **Şirketler** — filtreleyin, elle ekleyin ya da CSV yükleyin, göndereceklerinizi seçin.
3. **Mail Yaz** — taslağınızı yazın, *AI ile iyileştir* deyin (niyetinizi korur, sadece dili
   düzeltir ve spam skoru verir), isterseniz video ekleyin, gönderin. Mailler arasında 45-90 sn
   beklenir; saatlik 20 / günlük 50 limiti ve warm-up uygulanır.
4. **Gelen Kutusu** — *Yanıtlar* sekmesi varsayılan olarak sadece OLUMLU yanıtları gösterir; kartın
   içinden kısa bir not yazıp AI'ın düzelttiği yanıtı thread'e gönderebilirsiniz. *Gönderilenler*
   sekmesinde açılanlar yeşil, açılmayanlar kırmızı noktayla işaretlidir.
5. **Discord** — `!mailara ['İstanbul İçi Butik']`, `!mailcevap 42 "Yarın 15:00 uygun"`, `!durum`.

---

## Komutlar

```bash
npm run dev          # Next.js (localhost:3000)
npm run bot          # Discord botu
npm run db:studio    # veritabanını tarayıcıda gör
npm run workflows    # workflow JSON'larını üret
npm run n8n:sync     # list / backup / purge --yes / push / reset --yes
npm run gmail:auth   # Gmail refresh token
npm run launcher     # masaüstü kısayolu
```

---

## Yapı

```
app/     Next.js UI + API routes (veritabanına yalnızca burası yazar)
lib/     db, env, groq, gmail, mailer, inbox, video, companies, csv
bot/     Discord botu (ayrı process, sadece HTTP API'yi çağırır)
n8n/     workflow JSON'ları + silinen workflow yedekleri
scripts/ gmail-auth, n8n-sync, build-workflows, make-launcher
infra/   SearXNG docker-compose ve ayarları
media/   video ve önizleme dosyaları (git'e girmez)
```

Video önizlemesine oynat butonu basmak için ffmpeg gerekir: `winget install Gyan.FFmpeg`.
ffmpeg yoksa YouTube/Vimeo kapak görseli butonsuz kullanılır.
