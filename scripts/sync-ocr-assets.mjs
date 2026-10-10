/**
 * Copies the OCR runtime into public/ocr/ so the app serves it itself.
 *
 * tesseract.js would otherwise fetch its worker, its WASM core and its
 * language data from a public CDN the first time a resident uploads an ID.
 * The ID image never leaves the browser either way, but that fetch still
 * tells a third party that someone on this barangay's site is scanning a
 * government document. Serving the files ourselves removes the third party.
 *
 * Runs from `npm run ocr:assets`, and automatically before every build via
 * `prebuild`, so a production bundle can never be deployed with the paths
 * pointing at nothing.
 *
 * public/ocr/ is gitignored: these are ~13 MB of binaries reproducible from
 * node_modules, and they do not belong in the repository's history.
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const OUT = 'public/ocr'

/**
 * The language data comes in two builds. 4.0.0 is 10.4 MB; 4.0.0_best_int is
 * 2.8 MB, quantised, and loses nothing that matters for the clean printed
 * digits on an ID card. The smaller one is a 7.6 MB saving on a connection
 * that is often a phone's.
 */
const LANG_VARIANT = process.env.OCR_LANG_VARIANT ?? '4.0.0_best_int'

const FILES = [
  // The worker tesseract.js spawns.
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],

  // All three LSTM cores. The worker probes the browser and asks for exactly
  // one of these by name -- relaxed SIMD where available, plain SIMD next,
  // then neither -- so a missing variant is a hard failure on that browser
  // even though the other two are sitting right there. Only one is ever
  // downloaded by a given visitor.
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm', 'tesseract-core-relaxedsimd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],

  // English, trained. tesseract.js expects "<lang>.traineddata.gz" under langPath.
  [`node_modules/@tesseract.js-data/eng/${LANG_VARIANT}/eng.traineddata.gz`, 'eng.traineddata.gz'],

  // pdfjs rasterises page 1 of a PDF upload in its own worker.
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
]

/**
 * Directories pdfjs fetches from at render time. Both have to be served, and
 * both have to be served by US -- pdfjs defaults to a CDN for them, which is
 * exactly what this whole arrangement exists to avoid.
 *
 * standard_fonts: the Base-14 fonts (Helvetica, Times, Courier...). A PDF that
 *   names one without embedding it -- which is most text PDFs -- cannot be
 *   rendered without these. Leaving them out does not raise an error: the
 *   render promise simply never settles.
 * wasm: the JBIG2, OpenJPEG and colour-management codecs. A scanned ID, which
 *   is what a PDF upload here usually is, is a compressed image inside the
 *   PDF, and these are what decode it.
 */
const DIRS = [
  ['node_modules/pdfjs-dist/standard_fonts', 'standard_fonts'],
  ['node_modules/pdfjs-dist/wasm', 'wasm'],
]

mkdirSync(OUT, { recursive: true })

let total = 0
const copied = []
for (const [from, to] of FILES) {
  if (!existsSync(from)) {
    console.error(`\n  MISSING: ${from}`)
    console.error('  Run `npm install` first; the OCR assets come out of node_modules.\n')
    process.exit(1)
  }
  const dest = join(OUT, to)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(from, dest)
  const bytes = statSync(dest).size
  total += bytes
  copied.push({ to, bytes })
}

for (const [from, to] of DIRS) {
  if (!existsSync(from)) {
    console.error(`\n  MISSING: ${from}\n  Run \`npm install\` first.\n`)
    process.exit(1)
  }
  const dest = join(OUT, to)
  cpSync(from, dest, { recursive: true })
  let bytes = 0
  let count = 0
  for (const entry of readdirSync(dest, { withFileTypes: true })) {
    if (entry.isFile()) {
      bytes += statSync(join(dest, entry.name)).size
      count += 1
    }
  }
  total += bytes
  copied.push({ to: `${to}/ (${count} files)`, bytes })
}

// A manifest, so a deployment can be checked without guessing at filenames.
writeFileSync(
  join(OUT, 'manifest.json'),
  `${JSON.stringify(
    { lang: 'eng', variant: LANG_VARIANT, files: copied.map((c) => c.to), bytes: total },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`\n  OCR assets -> ${OUT}  (language build: ${LANG_VARIANT})`)
for (const c of copied) {
  console.log(`    ${(c.bytes / 1048576).toFixed(2).padStart(7)} MB  ${c.to}`)
}
console.log(`    ${'-'.repeat(7)}`)
console.log(`    ${(total / 1048576).toFixed(2).padStart(7)} MB  on disk, of which a browser downloads`)
console.log('              the worker, ONE core and the language data.\n')
