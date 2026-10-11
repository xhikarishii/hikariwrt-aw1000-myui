// Rebuild public/oui.tsv.gz, the MAC vendor list the Clients page reads,
// from the IEEE's registry of MA-L (24-bit) assignments:
//
//   curl -LO https://standards-oui.ieee.org/oui/oui.csv
//   node scripts/update-oui.mjs oui.csv
//
// One "PREFIX<TAB>Vendor" line per assignment (prefix as six hex digits),
// sorted, gzipped: about 390 kB for some 40 000 vendors. Company suffixes
// ("Co., Ltd.", "Inc.") are dropped, so the page shows "Samsung Electronics"
// rather than the registry's full legal name.

import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/update-oui.mjs <oui.csv>')
  process.exit(1)
}

/** RFC 4180-ish: quoted fields may hold commas and doubled quotes. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += '"', i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n') row.push(field), rows.push(row), (row = []), (field = '')
    else if (c !== '\r') field += c
  }
  if (field || row.length) row.push(field), rows.push(row)
  return rows
}

const SUFFIX = /[,.]?\s+(co\.?,?\s*ltd|corporation|corp|inc|incorporated|llc|ltd|limited|gmbh|s\.?a\.?|ag|b\.?v\.?|oy|ab|pty)\.?$/i

function shortName(name) {
  let n = name.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3; i++) n = n.replace(SUFFIX, '').trim()
  return n.replace(/[\s,.]+$/, '') || name.trim()
}

const rows = parseCsv(readFileSync(src, 'utf8')).slice(1)
const lines = rows
  .filter((r) => r[0] === 'MA-L' && /^[0-9A-F]{6}$/.test(r[1] ?? ''))
  .map((r) => `${r[1]}\t${shortName(r[2] ?? '')}`)
  .sort()
const out = new URL('../public/oui.tsv.gz', import.meta.url)
writeFileSync(out, gzipSync(lines.join('\n') + '\n', { level: 9 }))
console.log(`${lines.length} vendors -> ${out.pathname}`)
