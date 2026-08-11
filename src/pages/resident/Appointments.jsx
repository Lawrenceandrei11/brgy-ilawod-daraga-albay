import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format, isWeekend, parseISO, startOfDay } from 'date-fns'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { dayParts, longDate, timeOnly } from '../../lib/formatters'

/**
 * Appointment booking.
 *
 * The schema has no slot table, so slots are derived from office hours and
 * checked against existing bookings. These rules are a choice, not something
 * the prototype specified:
 *   weekdays only, 08:00-17:00, 30-minute slots, 2 windows, 30 days ahead.
 * Changing them means changing the constants below.
 */
const OPEN_HOUR = 8
const CLOSE_HOUR = 17
const SLOT_MINUTES = 30
const WINDOWS = 2
const DAYS_AHEAD = 30
const LUNCH_HOUR = 12 // the hall closes 12:00-13:00

function buildSlots(dateStr) {
  if (!dateStr) return []
  const day = startOfDay(parseISO(dateStr))
  const out = []
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h += 1) {
    if (h === LUNCH_HOUR) continue
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      const d = new Date(day)
      d.setHours(h, m, 0, 0)
      out.push(d)
    }
  }
  return out
}

export default function Appointments() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  const [date, setDate] = useState('')
  const [slot, setSlot] = useState(null)
  const [purpose, setPurpose] = useState('')
  const [error, setError] = useState(null)
  const [booked, setBooked] = useState(null)

  const minDate = format(addDays(new Date(), 1), 'yyyy-MM-dd')
  const maxDate = format(addDays(new Date(), DAYS_AHEAD), 'yyyy-MM-dd')

  const { data: mine, isLoading } = useQuery({
    queryKey: ['my-appointments', 'all', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .order('scheduled_at', { ascending: true })
      if (error) throw error
      return data
    },
  })

  // Every booking on the chosen day, so full slots can be greyed out. RLS
  // hides other residents' rows, so this is queried through a count-only
  // view of the day rather than reading their details.
  const { data: taken } = useQuery({
    queryKey: ['slots-taken', date],
    enabled: !!date,
    queryFn: async () => {
      const dayStart = startOfDay(parseISO(date)).toISOString()
      const dayEnd = addDays(startOfDay(parseISO(date)), 1).toISOString()
      const { data, error } = await supabase.rpc('slot_counts', { p_from: dayStart, p_to: dayEnd })
      if (error) throw error
      const map = {}
      for (const row of data ?? []) map[new Date(row.slot).getTime()] = row.taken
      return map
    },
  })

  const slots = useMemo(() => buildSlots(date), [date])
  const weekendChosen = date && isWeekend(parseISO(date))

  const upcoming = (mine ?? []).filter(
    (a) => a.status === 'booked' && new Date(a.scheduled_at) >= new Date()
  )
  const past = (mine ?? []).filter(
    (a) => a.status !== 'booked' || new Date(a.scheduled_at) < new Date()
  )

  async function book() {
    setError(null)
    try {
      const { error: insertError } = await supabase.from('appointments').insert({
        profile_id: profile.id,
        scheduled_at: slot.toISOString(),
        window_no: 1 + ((taken?.[slot.getTime()] ?? 0) % WINDOWS),
        purpose: purpose || 'Barangay hall visit',
      })
      if (insertError) throw insertError

      setBooked(slot)
      setSlot(null)
      setPurpose('')
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
      queryClient.invalidateQueries({ queryKey: ['slots-taken'] })
    } catch (err) {
      setError(friendlyError(err, 'That slot could not be booked. Please pick another.'))
    }
  }

  async function cancel(id) {
    try {
      const { error: updateError } = await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', id)
      if (updateError) throw updateError
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
      queryClient.invalidateQueries({ queryKey: ['slots-taken'] })
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <div className="dash-body">
      <div>
        <span className="eyebrow">Appointments</span>
        <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Book a visit to the barangay hall</h1>
      </div>

      {booked && (
        <Notice icon="check" title="Your appointment is booked">
          {longDate(booked)} at {timeOnly(booked)}. Bring a valid ID. If you cannot make it, cancel
          below so someone else can take the slot.
        </Notice>
      )}

      {error && (
        <Notice tone="danger" icon="alert" title="Could not book">
          {error}
        </Notice>
      )}

      <div className="grid-2" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 24, alignItems: 'start' }}>
        <Card padded>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>Pick a date and time</h2>
          <p style={{ fontSize: 14.5, color: 'var(--ink-500)', marginBottom: 22 }}>
            The barangay hall is open Monday to Friday, 8:00 AM – 5:00 PM, closed for lunch from
            12:00 to 1:00 PM.
          </p>

          <div style={{ maxWidth: 260, marginBottom: 22 }}>
            <Field
              label="Date"
              type="date"
              min={minDate}
              max={maxDate}
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setSlot(null)
              }}
              help={`Up to ${DAYS_AHEAD} days ahead`}
            />
          </div>

          {weekendChosen ? (
            <Notice tone="quiet" icon="info" title="The hall is closed at weekends">
              Pick a weekday between Monday and Friday.
            </Notice>
          ) : date ? (
            <>
              <div className="slots">
                {slots.map((s) => {
                  const takenCount = taken?.[s.getTime()] ?? 0
                  const full = takenCount >= WINDOWS
                  const isPast = s < new Date()
                  return (
                    <button
                      key={s.getTime()}
                      className="slot"
                      aria-pressed={slot?.getTime() === s.getTime()}
                      disabled={full || isPast}
                      onClick={() => setSlot(s)}
                    >
                      {format(s, 'h:mm a')}
                    </button>
                  )
                })}
              </div>

              {slot && (
                <div style={{ marginTop: 22, borderTop: '1px solid var(--ink-100)', paddingTop: 22 }}>
                  <div style={{ maxWidth: 420, marginBottom: 18 }}>
                    <Field
                      label="What is the visit for?"
                      hint="optional"
                      placeholder="e.g. Collecting a barangay clearance"
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                    />
                  </div>
                  <Button auto icon="cal" onClick={book}>
                    Book {format(slot, 'h:mm a')} on {format(slot, 'd MMM')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Notice tone="quiet" icon="cal" title="Choose a date to see the free slots">
              Slots already taken are shown crossed out.
            </Notice>
          )}
        </Card>

        <aside className="stack" style={{ gap: 24 }}>
          <Card flush>
            <CardHeader title="My upcoming visits" />
            {isLoading ? (
              <LoadingRows rows={2} />
            ) : upcoming.length ? (
              upcoming.map((a) => {
                const { day, month } = dayParts(a.scheduled_at)
                return (
                  <div className="appt" key={a.id}>
                    <div className="date">
                      <b>{day}</b>
                      <span>{month}</span>
                    </div>
                    <div className="grow">
                      <b style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-900)' }}>
                        {a.purpose}
                      </b>
                      <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
                        {timeOnly(a.scheduled_at)}
                        {a.window_no ? ` · Window ${a.window_no}` : ''}
                      </span>
                    </div>
                    <button
                      className="btn btn-s btn-ghost btn-auto"
                      onClick={() => cancel(a.id)}
                      style={{ color: 'var(--danger-600)' }}
                    >
                      Cancel
                    </button>
                  </div>
                )
              })
            ) : (
              <EmptyState icon="cal" title="Nothing booked">
                Booking a slot means you are seen at a set time instead of queueing.
              </EmptyState>
            )}
          </Card>

          {past.length > 0 && (
            <Card flush>
              <CardHeader title="Past and cancelled" />
              {past.slice(0, 5).map((a) => (
                <div className="appt" key={a.id} style={{ opacity: 0.7 }}>
                  <div className="grow">
                    <b style={{ display: 'block', fontSize: 14, color: 'var(--ink-700)' }}>
                      {a.purpose}
                    </b>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>
                      {longDate(a.scheduled_at)}
                    </span>
                  </div>
                  <Badge tone={a.status === 'cancelled' ? 'rejected' : 'released'}>
                    {a.status === 'cancelled' ? 'Cancelled' : 'Past'}
                  </Badge>
                </div>
              ))}
            </Card>
          )}

          <Notice icon="info" title="Running late?">
            Slots are held for 15 minutes. After that you may need to queue, or book again for
            another day.
          </Notice>
        </aside>
      </div>
    </div>
  )
}
