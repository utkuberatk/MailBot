/**
 * Discord komutlari (CLAUDE.md bolum 9).
 *
 *   !mailara ['İstanbul İçi Butik']   discovery tetikler, ozet doner
 *   !mailcevap 42 "Yarın 15:00 uygun"  AI ile duzeltip thread'e yanit verir
 *   !durum                             gonderilen / acilan / yanitlanan sayilari
 */

const { EmbedBuilder } = require('discord.js')
const api = require('./api')

const SENTIMENT_LABELS = { POSITIVE: 'Olumlu', NEUTRAL: 'Nötr', NEGATIVE: 'Olumsuz' }

/** Tirnak icindeki (düz, tek, kose parantezli) metni cikarir. */
function extractQuoted(input) {
  const match = input.match(/[['"“‘]([^\]'"”’]+)[\]'"”’]/)
  return match ? match[1].trim() : input.trim()
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function mailara(message, argument) {
  const prompt = extractQuoted(argument)
  if (!prompt) {
    await message.reply("Kullanım: `!mailara ['İstanbul İçi Butik']`")
    return
  }

  const notice = await message.reply(`🔍 Aranıyor: **${prompt}**`)
  const run = await api.post('/api/discover', { prompt, triggeredBy: 'discord' })

  // Discovery n8n tarafinda surer; durumu 5 saniyede bir yokla (en fazla 5 dk).
  for (let attempt = 0; attempt < 60; attempt++) {
    await wait(5000)
    const status = await api.get(`/api/discover/runs?runId=${run.runId ?? run.id}`)
    const current = status.run ?? status

    if (current.status === 'DONE') {
      const companies = status.companies ?? []
      const embed = new EmbedBuilder()
        .setColor(0x2563eb)
        .setTitle(`🔍 ${prompt}`)
        .setDescription(`**${companies.length}** şirket bulundu.`)

      for (const company of companies.slice(0, 10)) {
        embed.addFields({
          name: company.name.slice(0, 100),
          value:
            [company.email, company.phone, company.city].filter(Boolean).join(' · ') ||
            'iletişim bilgisi yok',
        })
      }

      await notice.edit({ content: '', embeds: [embed] })
      return
    }

    if (current.status === 'FAILED') {
      await notice.edit(`Arama başarısız: ${current.error ?? 'bilinmeyen hata'}`)
      return
    }
  }

  await notice.edit('Arama hâlâ sürüyor. Sonucu `/discover` sayfasından takip edin.')
}

async function mailcevap(message, argument) {
  const match = argument.match(/^\s*(\d+)\s+(.+)$/s)
  if (!match) {
    await message.reply(
      'Kullanım: `!mailcevap <yanıt-id> "mesajınız"`\n' +
        'Örnek: `!mailcevap 42 "Yarın 15:00 uygun"`\n\n' +
        await availableReplies(),
    )
    return
  }

  const replyId = match[1]
  const text = extractQuoted(match[2])

  const notice = await message.reply('✍️ Yanıt hazırlanıyor…')

  let result
  try {
    result = await api.post(`/api/replies/${replyId}/answer`, { text })
  } catch (error) {
    // En sik hata: elde olmayan bir ID yazmak. Hangi ID'lerin gecerli
    // oldugunu ve nereden alinacagini soyle.
    if (/bulunamad/i.test(error.message)) {
      await notice.edit(`❌ **${replyId}** numaralı yanıt yok.\n\n${await availableReplies()}`)
      return
    }
    throw error
  }

  const embed = new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle(`✉️ Yanıt gönderildi — ${result.company}`)
    .setDescription(result.sentText.slice(0, 1500))
    .addFields({ name: 'Alıcı', value: result.to })

  await notice.edit({ content: '', embeds: [embed] })
}

/** Yanit ID'si bilinmedigi durumlarda kullanilabilir listeyi hazirlar. */
async function availableReplies() {
  const data = await api.get('/api/replies')
  const replies = data.replies || []

  if (replies.length === 0) {
    return (
      'Şu an sistemde hiç yanıt kaydı yok — kimse gönderdiğiniz maile cevap vermemiş.\n' +
      'Yanıt geldiğinde bu kanala otomatik bildirim düşer ve ID’si orada yazar. ' +
      'Gmail’i hemen taratmak için uygulamadaki **Gelen Kutusu → Yanıtları çek** düğmesini kullanın.'
    )
  }

  const lines = replies
    .slice(0, 10)
    .map((reply) => {
      const label = SENTIMENT_LABELS[reply.sentiment] ?? reply.sentiment
      return `\`${reply.id}\` — ${reply.message.company.name} (${label}) · ${reply.fromEmail}`
    })
    .join('\n')

  return `**Yanıtlayabileceğiniz kayıtlar:**\n${lines}`
}

async function durum(message) {
  const stats = await api.get('/api/stats')

  const embed = new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle('📊 MailBot durumu')
    .addFields(
      { name: 'Şirket', value: String(stats.companies), inline: true },
      { name: 'Gönderilen', value: String(stats.sent), inline: true },
      { name: 'Açılan', value: String(stats.opened), inline: true },
      { name: 'Yanıt', value: String(stats.replies), inline: true },
      { name: 'Olumlu', value: String(stats.positive), inline: true },
      { name: 'Kuyrukta', value: String(stats.queued), inline: true },
      {
        name: 'Kalan kota',
        value: `bugün ${stats.quota.remainingToday}/${stats.quota.dailyLimit} · bu saat ${stats.quota.remainingThisHour}/${stats.quota.hourlyLimit}`,
      },
    )
    .setTimestamp(new Date())

  await message.reply({ embeds: [embed] })
}

/** Komut listesi ve nasil yazilacagini anlatan bilgilendirme sayfasi. */
async function komutlar(message) {
  const embed = new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle('📖 MailBot komutları')
    .setDescription(
      'Komutları yalnızca bot sahibi kullanabilir. ' +
        'Tırnak işaretleri `"..."`, `\'...\'` ve `[...]` biçimlerinin hepsi kabul edilir.',
    )
    .addFields(
      {
        name: '🔍 !mailara — şirket bul',
        value:
          '```\n!mailara [İstanbul İçi Butik]\n!mailara "Ankara organik kozmetik"\n```' +
          'Yazdığınız tarife uyan işletmeleri arar, iletişim bilgilerini çıkarır ve ' +
          '**Şirketler** listesine ekler. Sonuç 1-2 dakika sürer; bittiğinde bulunan ' +
          'şirket sayısı ve ilk 10 tanesi buraya düşer.\n' +
          '*Sektörü ve şehri açık yazın — tarif ne kadar net olursa sonuç o kadar isabetli olur.*',
      },
      {
        name: '✉️ !mailcevap — gelen yanıta cevap ver',
        value:
          '```\n!mailcevap 42 "Yarın 15:00 uygun, linki ben yollarım"\n```' +
          '`42` = **yanıt ID’si**. Kısa notunuzu yazın; AI onu Gmail’den elle yazılmış gibi ' +
          'düzeltip aynı yazışma zincirine gönderir. Notunuzdaki anlamı ve kimin ne yapacağını ' +
          'değiştirmez, yeni söz vermez.\n' +
          '**ID’yi nereden bulurum?** Olumlu bir yanıt geldiğinde bu kanala düşen bildirimin ' +
          '“Yanıt ID” alanında yazar. Uygulamada **Gelen Kutusu → Yanıtlar** sekmesinde de görürsünüz. ' +
          'Yanlış ID yazarsanız bot mevcut ID’leri listeler.',
      },
      {
        name: '📊 !durum — özet rapor',
        value:
          '```\n!durum\n```' +
          'Kayıtlı şirket, gönderilen, açılan, yanıt, olumlu yanıt ve kuyrukta bekleyen ' +
          'mail sayısını, ayrıca kalan günlük/saatlik gönderim hakkını gösterir.',
      },
      {
        name: '🔔 Otomatik bildirimler',
        value:
          'Gelen yanıtlar arasında **olumlu** olanlar dakikada bir kontrol edilir ve ' +
          'buraya otomatik düşer. Nötr ve olumsuz yanıtlar için bildirim gönderilmez; ' +
          'onları uygulamadaki Gelen Kutusu’ndan görebilirsiniz.',
      },
      {
        name: '⏱️ Gönderim limitleri',
        value:
          'Spam’e düşmemek için mailler arasında 45-90 sn beklenir. Isınma dönemi: ' +
          'ilk hafta günde 10, ikinci hafta 25, sonrasında 50 mail. Kalan hakkı `!durum` gösterir.',
      },
    )
    .setFooter({ text: 'Mail yazma ve şirket yönetimi için: http://localhost:3000' })

  await message.reply({ embeds: [embed] })
}

async function handleCommand(message) {
  const [command] = message.content.trim().split(/\s+/)
  const argument = message.content.trim().slice(command.length).trim()

  switch (command.toLowerCase()) {
    case '!mailara':
      return mailara(message, argument)
    case '!mailcevap':
      return mailcevap(message, argument)
    case '!durum':
      return durum(message)
    case '!komutlar':
    case '!yardim':
    case '!help':
      return komutlar(message)
    default:
      return message.reply(
        `Bilinmeyen komut: \`${command}\`\nKomut listesi için \`!komutlar\` yazın.`,
      )
  }
}

module.exports = { handleCommand, extractQuoted }
