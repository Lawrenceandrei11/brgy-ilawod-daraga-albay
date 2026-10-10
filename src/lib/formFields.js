import { z } from 'zod'

/**
 * Makes a coerced-number rule tolerate a field the resident left blank.
 *
 * `z.coerce.number()` turns '' into 0, and `.optional()` only admits
 * `undefined` — so an optional number with a `.min(1)` on it rejects an empty
 * input with "a household has at least one person", on a field labelled
 * optional. The union below lets the genuinely empty string through as
 * `undefined` instead.
 *
 * serviceFields.js has carried this idiom inline for a while; this is the
 * same expression with a name, so the next optional number gets it for free.
 */
export const optionalNumber = (rule) => rule.optional().or(z.literal('').transform(() => undefined))
