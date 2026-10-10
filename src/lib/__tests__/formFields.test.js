/**
 * The optional-number regression: a blank "People in the household" used to
 * fail with "A household has at least one person", on a field the form itself
 * labels optional, and that error blocked the whole step.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { optionalNumber } from '../formFields.js'

// The exact rule both forms use for household size.
const householdSize = optionalNumber(
  z.coerce.number().int().min(1, 'A household has at least one person').max(30),
)

test('a blank household size is accepted and means "not given"', () => {
  const r = householdSize.safeParse('')
  assert.equal(r.success, true)
  assert.equal(r.data, undefined)
})

test('an absent household size is still accepted', () => {
  const r = householdSize.safeParse(undefined)
  assert.equal(r.success, true)
  assert.equal(r.data, undefined)
})

test('a real household size still comes through as a number', () => {
  assert.deepEqual(householdSize.safeParse('4').data, 4)
  assert.deepEqual(householdSize.safeParse(4).data, 4)
  assert.deepEqual(householdSize.safeParse('30').data, 30)
  assert.deepEqual(householdSize.safeParse('1').data, 1)
})

test('the bounds are still enforced — blankness is the only thing excused', () => {
  assert.equal(householdSize.safeParse('0').success, false)
  assert.equal(householdSize.safeParse('31').success, false)
  assert.equal(householdSize.safeParse('-2').success, false)
  assert.equal(householdSize.safeParse('2.5').success, false)
  assert.equal(householdSize.safeParse('abc').success, false)
})

test('a blank optional field does not block the rest of the step', () => {
  // This is the shape of the bug: one blank optional field failed the object.
  const step = z.object({
    purok: z.coerce.number().int().min(1).max(7),
    household_size: householdSize,
  })
  const r = step.safeParse({ purok: '3', household_size: '' })
  assert.equal(r.success, true)
  assert.deepEqual(r.data, { purok: 3, household_size: undefined })
})

test('every consumer treats the undefined result as "no answer"', () => {
  // Both submit handlers and the review table use truthiness, so undefined
  // has to be falsy rather than 0 or NaN.
  const parsed = householdSize.safeParse('').data
  assert.equal(parsed ? Number(parsed) : null, null)
  assert.equal(parsed ? String(parsed) : 'Not given', 'Not given')
})
