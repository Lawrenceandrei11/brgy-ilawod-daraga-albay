/**
 * Run with:  npm test
 *
 * Node's own test runner, so this adds no dependency. The dates are built
 * relative to today rather than hard-coded, because "is this person 15" is a
 * question whose answer changes while nobody is looking.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MIN_REGISTRATION_AGE,
  isOldEnoughToRegister,
  residencyProblem,
  yearsSince,
} from '../age.js'

/**
 * An ISO date exactly `years` and `days` before today, in LOCAL terms.
 *
 * Built from the local calendar fields rather than toISOString(), which
 * converts to UTC first and so reports the previous day for anywhere east of
 * Greenwich -- quietly shifting every boundary case by a day depending on
 * what date it happens to be when the suite runs.
 */
function ago(years, days = 0) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  d.setDate(d.getDate() - days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

test('yearsSince counts only birthdays that have happened', () => {
  assert.equal(yearsSince(ago(30)), 30)
  assert.equal(yearsSince(ago(30, 1)), 30)
  // ago(29, -1) lands one day AFTER being born 29 years ago, so the 29th
  // birthday is still a day away: 28, not 29.
  assert.equal(yearsSince(ago(29, -1)), 28)
  assert.equal(yearsSince(ago(0)), 0)
})

test('yearsSince returns null rather than NaN for unusable input', () => {
  assert.equal(yearsSince(''), null)
  assert.equal(yearsSince(null), null)
  assert.equal(yearsSince(undefined), null)
  assert.equal(yearsSince('not a date'), null)
})

test('the minimum registration age is 15 and is enforced on the boundary', () => {
  assert.equal(MIN_REGISTRATION_AGE, 15)
  assert.equal(isOldEnoughToRegister(ago(15)), true)
  assert.equal(isOldEnoughToRegister(ago(15, 1)), true)
  // Turns 15 tomorrow — not yet.
  assert.equal(isOldEnoughToRegister(ago(15, -1)), false)
  assert.equal(isOldEnoughToRegister(ago(14)), false)
})

test('isOldEnoughToRegister rejects a missing or unreadable date', () => {
  assert.equal(isOldEnoughToRegister(''), false)
  assert.equal(isOldEnoughToRegister('rubbish'), false)
})

test('residency equal to age is allowed — lived here since birth', () => {
  assert.equal(residencyProblem(30, ago(30)), null)
  assert.equal(residencyProblem(0, ago(30)), null)
  assert.equal(residencyProblem(29, ago(30)), null)
})

test('residency greater than age is rejected, and says the age', () => {
  const problem = residencyProblem(31, ago(30))
  assert.ok(problem, 'expected a complaint')
  assert.match(problem, /longer than you have been alive/)
  assert.match(problem, /you are 30/)
})

test('the exact synthetic-data cases this was written for', () => {
  // resident0006: age 33, residency 34 -> rejected.
  assert.ok(residencyProblem(34, ago(33)))
  // resident0397: the proposed fix makes them 15 with 15 years -> allowed.
  assert.equal(residencyProblem(15, ago(15)), null)
  // The 20-year-old claiming 90 years, which the form used to accept.
  assert.ok(residencyProblem(90, ago(20)))
})

test('residencyProblem stays quiet when there is nothing to compare against', () => {
  // The date-of-birth validator owns that error; this one must not pile on.
  assert.equal(residencyProblem(40, ''), null)
  assert.equal(residencyProblem(40, null), null)
  assert.equal(residencyProblem(40, 'not a date'), null)
})

test('residencyProblem ignores non-numeric residency', () => {
  // min()/int() in the schema own that error.
  assert.equal(residencyProblem('', ago(30)), null)
  assert.equal(residencyProblem('abc', ago(30)), null)
})

test('string input is coerced, matching the form field', () => {
  assert.ok(residencyProblem('34', ago(33)))
  assert.equal(residencyProblem('33', ago(33)), null)
})
