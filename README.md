# MailBot

E-ticaret şirketlerini bulan, iletişim bilgilerini çıkaran, AI destekli soğuk mail gönderen ve gelen yanıtları analiz eden **tamamen local** bir mail otomasyon sistemi.

> Proje yol haritası ve tüm teknik kararlar için **[CLAUDE.md](./CLAUDE.md)** dosyasına bakın.

## Ne yapar?

- **Keşif** — Verdiğiniz prompta göre (ör. *"İstanbul içi butik"*) n8n + SearXNG ile e-ticaret şirketlerini bulur, iletişim bilgilerini çıkarır.
- **Mail gönderimi** — Seçtiğiniz şirketlere toplu mail atar. Taslağınızı Groq AI iyileştirir; maile video önizlemesi ekleyebilirsiniz.
- **Takip** — Açılan mailler yeşil, açılmayanlar kırmızı görünür.
- **Analiz** — Gelen yanıtları AI sınıflandırır; varsayılan olarak sadece **olumlu** yanıtlar listelenir.
- **Discord** — Olumlu yanıtlar Discord'a düşer; `!mailara` ve `!mailcevap` komutlarıyla evden uzaktayken de yönetirsiniz.

## Gereksinimler

| Araç | Not |
|---|---|
| Node.js 20+ | Uygulama ve Discord botu |
| Docker Desktop | SearXNG arama motoru |
| n8n | `localhost:5678` üzerinde çalışıyor olmalı |
| ffmpeg | Video thumbnail üretimi (Faz 5) |

Hepsi ücretsizdir. Groq ve Gmail API'leri de ücretsiz katmanda kullanılır.

## Kurulum

```bash
# 1. Ortam değişkenleri
cp .env.example .env      # ardından .env içindeki alanları doldurun

# 2. Bağımlılıklar ve veritabanı
npm install
npm run db:migrate

# 3. Arama motoru
docker compose -f infra/docker-compose.yml up -d

# 4. Gmail yetkilendirme
npm run gmail:auth

# 5. Çalıştır
npm run dev     # arayüz  -> http://localhost:3000
npm run bot     # Discord botu (ayrı terminal)
```

Kurulum tamamlandıktan sonra masaüstündeki **MailBot.bat** ile her şeyi tek tıkla başlatabilirsiniz.

## Durum

Proje kurulum aşamasında. İlerleme ve sıradaki adımlar için [CLAUDE.md → Yol haritası](./CLAUDE.md#6-yol-haritası) bölümüne bakın.
