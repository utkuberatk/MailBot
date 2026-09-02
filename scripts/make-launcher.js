#!/usr/bin/env node
/**
 * Masaustune tek tiklik MailBot.bat kisayolu uretir.
 *
 *   node scripts/make-launcher.js
 *
 * scripts/MailBot.bat sablonundaki proje klasoru satirini mutlak yola cevirir,
 * boylece dosya masaustunden calistirilinca da dogru klasore girer.
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..')
const TEMPLATE = path.join(__dirname, 'MailBot.bat')

const desktop = path.join(os.homedir(), 'Desktop')
if (!fs.existsSync(desktop)) {
  console.error(`\n✖ Masaustu klasoru bulunamadi: ${desktop}\n`)
  process.exit(1)
}

const script = fs
  .readFileSync(TEMPLATE, 'utf8')
  .replace('set "MAILBOT_DIR=%~dp0.."', `set "MAILBOT_DIR=${ROOT}"`)

const target = path.join(desktop, 'MailBot.bat')
fs.writeFileSync(target, script, 'utf8')

console.log(`\n✓ Kisayol olusturuldu: ${target}`)
console.log(`  Proje klasoru      : ${ROOT}\n`)
