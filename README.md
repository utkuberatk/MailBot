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
| `MAIL_TRACKING_URL` | Açılma takibi için **kendi alan adınız** (opsiyonel, aşağıya bakın) |

Google Cloud projesinde **Gmail API'yi etkinleştirmeyi** unutmayın; Discord Developer Portal'da
**MESSAGE CONTENT INTENT** açık olmalı.

### Mailim "Tanıtım" sekmesine düşüyor (`MAIL_STYLE`)

Tanıtım'a düşen mail spam değildir, kutuya teslim edilir — ama Gmail mobil uygulaması
**varsayılan olarak yalnızca Birincil sekme için bildirim** gönderir. Alıcının telefonu
titremez ve mail çoğu zaman hiç görülmez.

Gmail'i Tanıtım'a iten dört sinyal: `List-Unsubscribe` başlığı, HTML gövde, gövdedeki
abonelik dili ve maildeki linkler/takip pikseli. Tek tek ölümcül değil, birikimli çalışırlar.

**Varsayılan `MAIL_STYLE="personal"` dördünü de kaldırır:**

| | Kişisel mod (varsayılan) | `MAIL_STYLE="tracked"` |
|---|---|---|
| Gövde | tek parçalı `text/plain` | `multipart/alternative` + HTML |
| Link | **hiç yok** | video/CTA linki (takipliyse sarılmış) |
| Takip pikseli | yok | takip adresi varsa var |
| `List-Unsubscribe` | **gönderilmez** | gönderilir |
| Listeden çıkma | metnin sonunda doğal cümle | başlık + link/mailto |
| Açılma takibi | çalışmaz | çalışır |

Kişisel modda çıkış şöyle sunulur: *"İlginizi çekmiyorsa 'ilgilenmiyorum' yazıp yanıtlamanız
yeterli, bir daha yazmam."* Böyle bir yanıt gelirse şirket otomatik pasifleşir.

**Video ne olacak?** İlk maile link konmadığı için video, yanıt verenlere gönderilir: yanıt
kutusuna ya da `!mailcevap` metnine `{{video}}` yazın, sistem kampanyanın gerçek adresiyle
değiştirir.

**Garanti yok:** sekme kararını Gmail verir ve alıcının geçmiş davranışı da etkiler. En
kalıcı etki, alıcının maile **yanıt vermesidir** — Gmail o kişiyi kalıcı olarak Birincil'e
taşır. Bu yüzden AI metni bir soruyla bitirir.

### Açılma takibi ve spam (`MAIL_TRACKING_URL`)

> Aşağıdakiler yalnızca `MAIL_STYLE="tracked"` iken geçerlidir.


Takip pikseli ve video önizlemesi mailin **içinden** çağrılır, yani maildeki bağlantıların alan
adı doğrudan teslimatı etkiler. Geçici tünel adresleri (`*.trycloudflare.com`, `*.ngrok-free.app`)
oltalama için yoğun şekilde kötüye kullanıldığından, bu adreslere giden bağlantı içeren mailler
spam'e düşer. Bu yüzden sistem bu alan adlarını ve `http://` adresleri **reddeder**.

**Varsayılan (alan adı yok):** takip kapalıdır. Mailde takip pikseli ve görsel bulunmaz, listeden
çıkış `List-Unsubscribe: <mailto:...>` başlığıyla ve "bu mesajı yanıtlayıp *çıkar* yazın"
cümlesiyle yapılır. Yanıtla gelen çıkış talebi otomatik yakalanır ve şirket pasifleştirilir.
Sistemin tamamı çalışır; yalnızca yeşil/kırmızı açılma bilgisi olmaz.

#### Kendi alan adını bağlama (takibi açar)

Alan adı ücretlidir; gerisi ücretsizdir.

1. Alan adını Cloudflare'e ekleyin (Add a site → ücretsiz plan), nameserver'ları yönlendirin.
2. `cloudflared tunnel login` → `cloudflared tunnel create mailbot`
3. Tünele bir alt alan adı bağlayın:
   `cloudflared tunnel route dns mailbot mail.alanadiniz.com`
4. `~/.cloudflared/config.yml` içinde `mail.alanadiniz.com` → `http://localhost:3000` eşlemesini yazın.
5. `.env`:
   ```
   MAIL_TRACKING_URL="https://mail.alanadiniz.com"
   CLOUDFLARE_TUNNEL_NAME="mailbot"
   ```

Artık `MailBot.bat` tüneli otomatik başlatır, piksel ve video önizlemesi kendi alan adınızdan
servis edilir, açılma takibi çalışır.

#### Takip açıkken ne olur

- **Gelen Kutusu → Gönderilenler**: ✓ gönderildi · **✓✓** açıldı · **🔗** maildeki linke tıklandı.
  Satıra tıklayınca açılma/tıklama geçmişi (zaman + cihaz) açılır.
- **Discord**: bir şirket mailinizi ilk kez açtığında kanala `📖 ... mailinizi açtı` bildirimi
  düşer (aynı mail için yalnızca bir kez).
- **Sahte açılma filtresi**: mail tarayıcılarının ve önizleme botlarının ürettiği istekler
  `TrackEvent.isBot` olarak işaretlenir, sayaçlara girmez. Gmail'in görsel proxy'si
  (`GoogleImageProxy`) **gerçek açılmadır**, elenmez.
- **Sınırlar**: alıcı görselleri engellerse açılma hiç görünmez (tıklama takibi bu durumda tek
  sinyaldir); Gmail görselleri önbelleğe aldığı için açılma sayısı olduğundan az çıkabilir.
  Yani "açılmadı" kesin bir bilgi değildir, "açıldı" kesindir.

#### Alan adı gelmeden test etmek

`.env` içine `TRACKING_DEV_LOCAL="1"` + `MAIL_TRACKING_URL="http://127.0.0.1:3000"` yazın.
Zincirin tamamı yerelde çalışır; UI kırmızı **GELİŞTİRME MODU** uyarısı gösterir. Bu maillerdeki
takip linkleri alıcının bilgisayarında çalışmaz — gerçek gönderim öncesi kaldırın.

Uygulama dışarı açıldığında iç uçlar `X-Internal-Key` olmadan çalışmaz; dışarıdan yalnızca takip
pikseli, çıkış linki ve `/media` erişilebilir.

`npm run tunnel` `CLOUDFLARE_TUNNEL_NAME` boşken geçici bir tünel açar — bu adres **yalnızca
arayüze uzaktan bakmak içindir**, mail takibinde kullanılamaz.

---

## Kullanım

1. **Keşfet** — prompt yazın (örn. *İstanbul içi butik mağazalar*), n8n arama yapıp iletişim
   bilgileriyle şirketleri tabloya düşürür.
2. **Şirketler** — filtreleyin, elle ekleyin ya da CSV yükleyin, göndereceklerinizi seçin.
3. **Mail Yaz** — taslağınızı yazın, *AI ile iyileştir* deyin (niyetinizi korur, sadece dili
   düzeltir, spam ve Tanıtım sekmesi riskini gösterir), isterseniz video ekleyin, gönderin. Mailler arasında 45-90 sn
   beklenir. Isınma dönemi: ilk 3 gün 5, 1. hafta 10, 2. hafta 20, 3. hafta 35, sonrasında 50
   mail/gün. Kalan hak ve aşama sayfanın sağ üstünde yazar.
4. **Gelen Kutusu** — *Yanıtlar* sekmesi varsayılan olarak sadece OLUMLU yanıtları gösterir; kartın
   içinden kısa bir not yazıp AI'ın düzelttiği yanıtı thread'e gönderebilirsiniz (`{{video}}`
   yazarsanız kampanyanın video adresi eklenir). *Gönderilenler* sekmesi kişisel modda yalnızca
   gönderim durumunu gösterir; `MAIL_STYLE="tracked"` iken açılanlar ✓✓ ile işaretlenir.
5. **Discord** — `!komutlar` yazınca tüm komutların anlatıldığı sayfa gelir:
   `!mailara ['İstanbul İçi Butik']`, `!mailcevap 42 "Yarın 15:00 uygun"`, `!durum`.
   `!mailcevap`'taki sayı yanıt ID'sidir; bildirim mesajında ve Gelen Kutusu'nda yazar.

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
npm run tunnel       # cloudflared tüneli (açılma takibi)
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
