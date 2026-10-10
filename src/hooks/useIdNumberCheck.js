import { useEffect, useMemo, useState } from 'react'

import { idCheckState } from '../lib/idCheck'
import { readIdDocument } from '../lib/idOcr'

/**
 * Keeps the ID-number check in step with the form.
 *
 * The only side effect is OCR, and it runs when the FILE changes -- not when
 * the resident edits the number, which would mean re-reading the document on
 * every keystroke. The comparison itself is derived during render, so editing
 * the number or the ID type re-decides immediately and an earlier match
 * cannot linger.
 *
 * `readDocument` is injectable so tests and stories can supply a fake engine.
 */
export function useIdNumberCheck({ file, entered, idType, readDocument = readIdDocument }) {
  const [read, setRead] = useState(null)

  useEffect(() => {
    if (!file) {
      setRead(null)
      return undefined
    }

    let cancelled = false
    const controller = new AbortController()
    // Tagged with the file, so a result that arrives after the resident has
    // swapped the document is ignored rather than shown against the new one.
    setRead({ file, status: 'reading', result: null })

    readDocument(file, { signal: controller.signal }).then(
      (result) => {
        if (!cancelled) setRead({ file, status: 'done', result })
      },
      () => {
        if (!cancelled) {
          setRead({ file, status: 'done', result: { ok: false, reason: 'engine-failed' } })
        }
      },
    )

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [file, readDocument])

  // The OCR worker is deliberately NOT torn down here.
  //
  // It is a module-level singleton shared across the wizard's steps, so
  // terminating it when this component unmounts breaks the next read -- and
  // under StrictMode, which mounts, cleans up and mounts again, it broke the
  // very first one: the worker was terminated while a recognise was still in
  // flight, which surfaced as postMessage on null. It is reused instead and
  // freed when the tab goes. terminateIdOcr stays exported for a caller that
  // genuinely owns the whole page's lifetime.

  return useMemo(
    () => idCheckState({ file, entered, idType, read }),
    [file, entered, idType, read],
  )
}
