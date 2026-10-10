/**
 * Age rules, in one place.
 *
 * Both the registration wizard and the resident's own profile editor need to
 * agree on two things: how old somebody is, and whether the years of residency
 * they typed is possible. They used to agree only by coincidence — the wizard
 * had its own copy of the age maths and the profile editor had no residency
 * check at all, so a resident could claim ninety years in the barangay at the
 * age of twenty.
 */

/** Residents must be this old to register. */
export const MIN_REGISTRATION_AGE = 15

/**
 * Completed years between `dateString` and today — the same calendar rule a
 * barangay clerk would use: the birthday has to have happened already.
 * Returns null for anything unparseable, so callers can skip the check rather
 * than compare against NaN.
 */
export function yearsSince(dateString) {
  if (!dateString) return null
  const dob = new Date(dateString)
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1
  return age
}

/** True when the date of birth clears MIN_REGISTRATION_AGE. */
export function isOldEnoughToRegister(dateString) {
  const age = yearsSince(dateString)
  return age !== null && age >= MIN_REGISTRATION_AGE
}

/**
 * The complaint about `years` given `dateOfBirth`, or null when there is none.
 *
 * Nobody can have lived somewhere longer than they have been alive. Where the
 * date of birth is missing or unreadable there is nothing to compare against,
 * so this stays quiet and lets the date-of-birth validator do the talking.
 */
export function residencyProblem(years, dateOfBirth) {
  const n = Number(years)
  if (!Number.isFinite(n)) return null
  const age = yearsSince(dateOfBirth)
  if (age === null || age < 0) return null
  if (n > age) {
    return `You cannot have lived here longer than you have been alive — you are ${age}, so enter ${age} or fewer`
  }
  return null
}
