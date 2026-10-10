/**
 * Reading the text off an uploaded ID, in the resident's own browser.
 *
 * Everything runs locally. The image is never uploaded for this, no signed
 * URL is created, and the worker, the WASM core and the language data are
 * served by this app from /ocr -- never a public CDN. scripts/sync-ocr-assets.mjs
 * puts them there, and `prebuild` runs it, so a deployed build always has them.
 *
 * Nothing is logged. OCR text off an ID carries a name, an address and a
 * number, so it is returned to the caller and otherwise left alone; even
 * engine errors are reported as a flat reason rather than a message that
 * might quote what was read.
 *
 * This reads characters. It does not judge whether the ID is real, current,
 * or the uploader's own -- see idNumber.js.
 */

import { isPdf, validateIdFile } from './idFile.js'
import { normalizeIdNumber as normalizeIdNumberish } from './idNumber.js'

/** Where the self-hosted runtime lives. Configurable for odd deployments. */
const OCR_BASE = (import.meta.env?.VITE_OCR_ASSET_PATH ?? '/ocr').replace(/\/+$/, '')

/** Longest edge handed to the engine. Bigger reads better and costs time. */
const DEFAULT_MAX_DIMENSION = 2000

/**
 * How long to let a read run before giving up on it.
 *
 * A read that never settles is worse than one that fails: the resident is
 * left watching "checking…" with no way forward and no explanation. Whatever
 * the cause -- a slow phone, a PDF the rasteriser cannot finish, a worker
 * that dies quietly -- the honest outcome after this long is "we could not
 * check it", which is the path to the secretary.
 */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Rasterising gets a much shorter leash than recognising. Turning page one
 * into a bitmap is quick when it works at all, so a PDF still sitting there
 * after this long is not going to finish, and the resident is better served
 * by being told so and sent to manual review.
 */
const DEFAULT_PDF_TIMEOUT_MS = 8_000

/** Rejects if `promise` has not settled within `ms`. */
function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    }),
  ])
}

let workerPromise = null
let pdfWorkerPort = null

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Dynamic import: tesseract.js stays out of the main bundle and is
      // fetched only when a resident actually uploads an ID.
      const { createWorker, OEM, PSM } = await import('tesseract.js')
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${OCR_BASE}/worker.min.js`,
        corePath: OCR_BASE,
        langPath: OCR_BASE,
        gzip: true,
        // No logger on purpose. The default is silent, and a progress logger
        // here is how OCR text ends up in a console.
      })
      // Sparse text: an ID card is scattered fields, not a paragraph.
      //
      // No character whitelist. It is tempting to allow only digits and
      // capitals, but a whitelist degrades the LSTM engine's own guesses, and
      // the surrounding words are what tell us a number is a number. The
      // filtering belongs in idNumber.js, where it cannot damage the read.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
      return worker
    })()
  }
  return workerPromise
}

/** Free the worker. Worth calling when the registration screen unmounts. */
export async function terminateIdOcr() {
  const pending = workerPromise
  workerPromise = null
  if (!pending) return
  try {
    const worker = await pending
    await worker.terminate()
  } catch {
    // Already gone, or never started. Nothing to report.
  }
}

/** Flatten whatever shape this engine version reports into {text, confidence}. */
function tokensFrom(data) {
  const out = []
  const push = (w) => {
    if (w && typeof w.text === 'string') {
      out.push({ text: w.text, confidence: typeof w.confidence === 'number' ? w.confidence : 0 })
    }
  }
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node.words)) node.words.forEach(push)
    for (const key of ['blocks', 'paragraphs', 'lines']) {
      if (Array.isArray(node[key])) node[key].forEach(walk)
    }
  }
  walk(data)
  if (out.length) return out

  // Older or trimmed output: fall back to the overall confidence per word, so
  // the comparison still has something to weigh.
  const overall = typeof data?.confidence === 'number' ? data.confidence : 0
  return String(data?.text ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => ({ text, confidence: overall }))
}

/**
 * Open a PDF and get at page one.
 *
 * Split out from the rest because a PDF has two quite different routes
 * through this file, and only one of them involves OCR at all.
 */
async function openPdfFirstPage(file) {
  const pdfjs = await import('pdfjs-dist')

  // pdfjs 6 ships its worker as an ES module, and GlobalWorkerOptions.workerSrc
  // spawns a CLASSIC worker -- which cannot import it. That combination does
  // not throw; it stalls. The worker is therefore constructed here with
  // { type: 'module' } and handed over as a port. One worker, reused.
  if (!pdfWorkerPort) {
    pdfWorkerPort = new Worker(`${OCR_BASE}/pdf.worker.min.mjs`, {
      type: 'module',
      name: 'pdfjs-id-reader',
    })
  }
  pdfjs.GlobalWorkerOptions.workerPort = pdfWorkerPort

  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({
    data,
    // An uploaded PDF is untrusted input. No scripting, no outside fetches.
    isEvalSupported: false,
    disableAutoFetch: true,
    disableRange: true,
    // Both of these default to a CDN. Pointed at our own copies instead --
    // see scripts/sync-ocr-assets.mjs.
    standardFontDataUrl: `${OCR_BASE}/standard_fonts/`,
    wasmUrl: `${OCR_BASE}/wasm/`,
  }).promise

  const page = await doc.getPage(1)
  return { doc, page }
}

/**
 * The text a PDF already carries, if it carries any.
 *
 * Most PDFs of a document -- anything produced by a printer driver or an
 * agency's own system rather than a camera -- have a text layer. Reading it
 * is exact: these are the characters the file says are there, not a guess at
 * pixels, so there is no OCR error to allow for and nothing to download. A
 * scan has no text layer and comes back empty, which is the signal to fall
 * back to rasterising.
 */
async function pdfTextLayer(page) {
  const content = await page.getTextContent()
  return (content?.items ?? [])
    .map((i) => (typeof i?.str === 'string' ? i.str : ''))
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** Render a page to a canvas the OCR engine can read. */
async function pdfPageToCanvas(page, maxDimension) {
  const unscaled = page.getViewport({ scale: 1 })
  const longest = Math.max(unscaled.width, unscaled.height) || 1
  // Scale up a small page so the digits are legible, but never past 3x.
  const scale = Math.min(Math.max(maxDimension / longest, 1), 3)
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  // A white ground: a transparent PDF over black reads as nothing at all.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas
}

/**
 * Read an uploaded ID.
 *
 * Returns { ok: true, text, confidence, tokens } or { ok: false, reason }
 * where reason is 'unsupported' (with the existing upload message),
 * 'aborted', or 'engine-failed'. A failure is never a verdict on the
 * resident -- idNumber.js turns an unread document into 'uncertain', which
 * goes to the secretary.
 */
export async function readIdDocument(
  file,
  {
    signal,
    maxDimension = DEFAULT_MAX_DIMENSION,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pdfTimeoutMs = DEFAULT_PDF_TIMEOUT_MS,
  } = {},
) {
  const problem = validateIdFile(file)
  if (problem) return { ok: false, reason: 'unsupported', message: problem }

  let source = file

  if (isPdf(file)) {
    // A PDF has two routes, and the first does not involve OCR at all.
    let doc
    try {
      const opened = await withTimeout(openPdfFirstPage(file), pdfTimeoutMs, 'PDF open')
      doc = opened.doc
      if (signal?.aborted) return { ok: false, reason: 'aborted' }

      // Route one: the text the file already carries. Exact characters, no
      // guessing, no language data to download, and typically a few
      // milliseconds. Anything not produced by a camera usually has this.
      const layer = await withTimeout(pdfTextLayer(opened.page), pdfTimeoutMs, 'PDF text')
      if (normalizeIdNumberish(layer).length >= 5) {
        return {
          ok: true,
          source: 'pdf-text',
          text: layer,
          // Not a confidence score in the OCR sense: these are the characters
          // the document declares, so there is nothing to be unsure about.
          confidence: 100,
          tokens: layer
            .split(/\s+/)
            .filter(Boolean)
            .map((text) => ({ text, confidence: 100 })),
        }
      }

      // Route two: a scan, with no text layer. Rasterise page one and OCR it.
      // Given a short leash of its own -- nobody should wait out the full OCR
      // allowance only to be told the page could not be drawn.
      source = await withTimeout(
        pdfPageToCanvas(opened.page, maxDimension),
        pdfTimeoutMs,
        'PDF rendering',
      )
      if (signal?.aborted) return { ok: false, reason: 'aborted' }
    } catch {
      // The worker may be wedged; drop it so a later attempt builds a fresh
      // one. Then say plainly that this PDF could not be read here.
      try {
        pdfWorkerPort?.terminate()
      } catch {
        /* already gone */
      }
      pdfWorkerPort = null
      return { ok: false, reason: 'pdf-unreadable' }
    } finally {
      doc?.destroy?.()
    }
  }

  try {

    const worker = await withTimeout(getWorker(), timeoutMs, 'OCR startup')
    const { data } = await withTimeout(
      worker.recognize(source, {}, { blocks: true, text: true }),
      timeoutMs,
      'OCR',
    )
    if (signal?.aborted) return { ok: false, reason: 'aborted' }

    return {
      ok: true,
      text: String(data?.text ?? ''),
      confidence: typeof data?.confidence === 'number' ? data.confidence : 0,
      tokens: tokensFrom(data),
    }
  } catch {
    // A worker that timed out or threw is not trustworthy for the next
    // attempt, so it is dropped rather than reused. The next read builds a
    // fresh one.
    workerPromise = null

    // The error object can quote the page's text. It is not logged and not
    // passed on; the caller only needs to know the read did not happen.
    return {
      ok: false,
      reason: 'engine-failed',
      message: 'The ID could not be read on this device.',
    }
  }
}
