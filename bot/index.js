/**
 * MailBot Discord botu.
 *
 *   npm run bot
 *
 * Uygulamanin HTTP API'sini cagirir; veritabanina dogrudan dokunmaz.
 * Komutlari yalnizca DISCORD_OWNER_ID calistirabilir.
 * Yeni POZITIF yanitlar belirlenen kanala embed olarak dusulur.
 */

require('dotenv/config')

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js')
const api = require('./api')
const { handleCommand } = require('./commands')

const TOKEN = process.env.DISCORD_BOT_TOKEN
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID
const OWNER_ID = process.env.DISCORD_OWNER_ID

/** Yeni olumlu yanitlarin kontrol araligi. */
const POLL_INTERVAL_MS = 60_000

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

if (!TOKEN) fail('DISCORD_BOT_TOKEN tanimli degil. .env dosyasina ekleyin.')
if (!OWNER_ID) fail('DISCORD_OWNER_ID tanimli degil. .env dosyasina ekleyin.')
if (!CHANNEL_ID) fail('DISCORD_CHANNEL_ID tanimli degil. .env dosyasina ekleyin.')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
})

/** Olumlu yanit bildirimi. */
function replyEmbed(reply) {
  return new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle(`✅ Olumlu yanıt — ${reply.message.company.name}`)
    .setDescription(reply.summary || reply.bodyText.slice(0, 300))
    .addFields(
      { name: 'Gönderen', value: reply.fromEmail, inline: true },
      { name: 'Yanıt ID', value: `\`${reply.id}\``, inline: true },
      { name: 'Konu', value: reply.message.subject.slice(0, 100) },
    )
    .setFooter({ text: `Yanıtlamak için: !mailcevap ${reply.id} "mesajınız"` })
    .setTimestamp(new Date(reply.receivedAt))
}

/** Bildirilmemis olumlu yanitlari kanala dus, sonra isaretle. */
async function pushPositiveReplies() {
  let channel
  try {
    channel = await client.channels.fetch(CHANNEL_ID)
  } catch {
    console.error(`[bot] Kanal bulunamadi: ${CHANNEL_ID}. DISCORD_CHANNEL_ID dogru mu?`)
    return
  }

  const data = await api.get('/api/replies?sentiment=POSITIVE&notified=0')
  const replies = data.replies || []
  if (replies.length === 0) return

  for (const reply of replies) {
    await channel.send({ embeds: [replyEmbed(reply)] })
  }

  await api.patch('/api/replies', { ids: replies.map((reply) => reply.id) })
  console.log(`[bot] ${replies.length} olumlu yanit bildirildi.`)
}

client.once('clientReady', async () => {
  console.log(`\n✓ Bot hazir: ${client.user.tag}`)
  console.log(`  Kanal   : ${CHANNEL_ID}`)
  console.log(`  Sahip   : ${OWNER_ID}`)
  console.log(`  Uygulama: ${api.APP_URL}\n`)

  const tick = () =>
    pushPositiveReplies().catch((error) => console.error('[bot] bildirim hatasi:', error.message))

  tick()
  setInterval(tick, POLL_INTERVAL_MS)
})

client.on('messageCreate', async (message) => {
  if (message.author.bot) return
  if (!message.content.startsWith('!')) return

  if (message.author.id !== OWNER_ID) {
    await message.reply('Bu botu yalnızca sahibi kullanabilir.')
    return
  }

  try {
    await handleCommand(message)
  } catch (error) {
    console.error('[bot] komut hatasi:', error)
    await message.reply(`Hata: ${error.message}`)
  }
})

client.login(TOKEN).catch((error) => {
  fail(
    `Discord girisi basarisiz: ${error.message}\n` +
      'DISCORD_BOT_TOKEN dogru mu? Bot ayarlarinda MESSAGE CONTENT INTENT acik olmali.',
  )
})
