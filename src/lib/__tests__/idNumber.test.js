/**
 * Normalising and masking ID numbers.
 *
 * This file was 295 lines of OCR-candidate extraction, confidence scoring and
 * confusable folding. All of it existed to find a number inside a page of
 * tesseract output and decide whether a bad reading was worth acting on. The
 * reader returns the field directly now, so what remains is the one rule that
 * always mattered: which differences between two strings are meaningless.
 *
 * Every number below is invented.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { maskIdNumber, normalizeIdNumber } from '../idNumber.js'

test('case, spaces and hyphens are the only things normalised away', () => {
  const same = [
    '1234567890123456',
    '1234-5678-9012-3456',
    '1234 5678 9012 3456',
    '  1234567890123456  ',
    '1234/5678/9012/3456',
  ]
  const expected = '1234567890123456'
  for (const v of same) assert.equal(normalizeIdNumber(v), expected, v)

  assert.equal(normalizeIdNumber('n01-12-123456'), 'N0112123456')
  assert.equal(normalizeIdNumber('p1234567a'), 'P1234567A')
})

test('a character that differs is a number that differs', () => {
  // The old code folded these onto each other and called it a match. It is
  // not one: S1234567 and 51234567 are different passport numbers.
  assert.notEqual(normalizeIdNumber('S1234567'), normalizeIdNumber('51234567'))
  assert.notEqual(normalizeIdNumber('B1234567'), normalizeIdNumber('81234567'))
  assert.notEqual(normalizeIdNumber('O123456'), normalizeIdNumber('0123456'))
})

test('anything that is not a string normalises to nothing', () => {
  for (const v of [null, undefined, 42, {}, []]) assert.equal(normalizeIdNumber(v), '')
  assert.equal(normalizeIdNumber(''), '')
  assert.equal(normalizeIdNumber('---'), '', 'punctuation alone is not a number')
})

test('masking shows the last four and never the rest', () => {
  assert.equal(maskIdNumber('1234567890123456'), '••••••••3456')
  assert.equal(maskIdNumber('1234-5678'), '••••5678')
  // Short enough that even four digits would give it away.
  assert.equal(maskIdNumber('1234'), '••••')
  assert.equal(maskIdNumber('12'), '••')
  assert.equal(maskIdNumber(''), '')
  assert.equal(maskIdNumber(null), '')
})

test('a masked number never contains the number', () => {
  for (const v of ['1234567890123456', 'N01-12-123456', 'P1234567A']) {
    const masked = maskIdNumber(v)
    const full = normalizeIdNumber(v)
    assert.ok(!masked.includes(full), v)
    assert.equal(masked.length, full.length <= 4 ? full.length : Math.min(full.length - 4, 8) + 4)
  }
})
