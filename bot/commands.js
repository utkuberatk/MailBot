/**
 * Discord komutlari (CLAUDE.md bolum 9).
 *
 *   !mailara ['İstanbul İçi Butik']   discovery tetikler, ozet doner
 *   !mailcevap 42 "Yarın 15:00 uygun"  AI ile duzeltip thread'e yanit verir
 *   !durum                             gonderilen / acilan / yanitlanan sayilari
 */

const { EmbedBuilder } = require('discord.js')
const api = require('./api')

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
    await message.reply('Kullanım: `!mailcevap 42 "Yarın 15:00 uygun"`')
    return
  }

  const replyId = match[1]
  const text = extractQuoted(match[2])

  const notice = await message.reply('✍️ Yanıt hazırlanıyor…')
  const result = await api.post(`/api/replies/${replyId}/answer`, { text })

  const embed = new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle(`✉️ Yanıt gönderildi — ${result.company}`)
    .setDescription(result.sentText.slice(0, 1500))
    .addFields({ name: 'Alıcı', value: result.to })

  await notice.edit({ content: '', embeds: [embed] })
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

const HELP = [
  '**MailBot komutları**',
  "`!mailara ['İstanbul İçi Butik']` — şirket araması başlatır",
  '`!mailcevap 42 "Yarın 15:00 uygun"` — yanıtı AI ile düzeltip gönderir',
  '`!durum` — gönderilen / açılan / yanıtlanan sayıları',
].join('\n')

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
    case '!yardim':
    case '!help':
      return message.reply(HELP)
    default:
      return message.reply(`Bilinmeyen komut. ${HELP}`)
  }
}

module.exports = { handleCommand, extractQuoted }
