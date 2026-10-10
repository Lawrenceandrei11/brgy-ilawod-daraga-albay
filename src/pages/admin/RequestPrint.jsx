import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { supabase, friendlyError } from '../../lib/supabase'
import { Button, Notice } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { MainLogo } from '../../components/MainLogo'
import { DocumentSheet } from '../../components/DocumentSheet'
import { buildDocument, canPrint } from '../../lib/documentTemplate'

/**
 * A printable barangay document.
 *
 * Deliberately its own page rather than a dialog over the review screen: the
 * print stylesheet can then hide everything except the sheet, and what comes
 * out of the printer is what is on screen.
 *
 * It reads. It does not write, and it does not move the request along -- the
 * workflow and the Punong Barangay's approval are untouched by printing.
 *
 * Everything here is DRAFT wording. Until Barangay Ilawod supplies its own
 * prescribed text, the banner stays and the sheet carries a draft mark, so a
 * printed copy cannot be mistaken for an official issuance.
 */
export default function RequestPrint() {
  const { ref } = useParams()

  // Only the columns the templates actually print. The wildcard this started
  // with pulled every profile column to the browser -- email, mobile, the ID
  // number and its storage path -- none of which appears on a certificate.
  // All seven verified against the live schema before narrowing.
  const PRINTED_PROFILE_COLUMNS =
    'full_name, date_of_birth, civil_status, address_line, purok, years_of_residency, resident_id'

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-request-print', ref],
    queryFn: async () => {
      const { data: request, error: requestError } = await supabase
        .from('document_requests')
        .select(
          `*, services(*), profiles!document_requests_profile_id_fkey(${PRINTED_PROFILE_COLUMNS})`,
        )
        .eq('ref_no', ref)
        .maybeSingle()
      if (requestError) throw requestError
      if (!request) return null

      // The approval line comes from the history row and nowhere else. If the
      // request was never approved, there is simply no line.
      const { data: history } = await supabase
        .from('request_status_history')
        .select('from_status, to_status, changed_by_name, created_at')
        .eq('request_id', request.id)
        .eq('to_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(1)

      const [{ data: settings }, { data: officials }] = await Promise.all([
        supabase.from('settings').select('key, value').eq('key', 'barangay').maybeSingle(),
        supabase
          .from('officials')
          .select('name, position')
          .eq('active', true)
          .order('sort_order'),
      ])

      // Only the Punong Barangay signs. No other official is substituted in.
      const official =
        (officials ?? []).find((o) => /punong\s*barangay/i.test(o.position ?? '')) ?? null

      return {
        request,
        approval: history?.[0] ?? null,
        barangay: settings?.value ?? null,
        official,
      }
    },
  })

  if (isLoading) return <LoadingRows />

  // A failed fetch and a reference that does not exist are different problems
  // with different remedies, and telling staff to "check the reference number"
  // when the network dropped sends them looking in the wrong place.
  if (isError) {
    return (
      <div className="wrap" style={{ paddingTop: 24 }}>
        <Notice tone="danger" icon="alert" title="This request could not be loaded">
          {friendlyError(error, 'Something went wrong while loading the request. Try again.')}
        </Notice>
        <Button to={`/admin/requests/${ref}`} variant="secondary" auto style={{ marginTop: 16 }}>
          Back to the request
        </Button>
      </div>
    )
  }

  if (!data?.request) {
    return <EmptyState icon="doc" title="No such request" body="Check the reference number." />
  }

  const { request, approval, barangay, official } = data

  if (!canPrint(request)) {
    return (
      <div className="wrap" style={{ paddingTop: 24 }}>
        <Notice tone="danger" icon="alert" title="This request cannot be printed yet">
          A document is printable once the Punong Barangay has approved it. This request is
          currently <b>{request.status}</b>.
        </Notice>
        <Button to={`/admin/requests/${ref}`} variant="secondary" auto style={{ marginTop: 16 }}>
          Back to the request
        </Button>
      </div>
    )
  }

  const doc = buildDocument({
    request,
    profile: request.profiles,
    service: request.services,
    approval,
    barangay,
    official,
  })

  return (
    <div className="wrap docpage">
      {/* Screen-only controls. The print stylesheet removes this entirely. */}
      <div className="docbar noprint">
        <Button to={`/admin/requests/${ref}`} variant="ghost" size="s" auto icon="arrow">
          Back to the request
        </Button>
        <Button size="s" auto icon="print" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>

      <div className="noprint" style={{ marginBottom: 16 }}>
        <Notice tone="danger" icon="alert" title="Draft wording — not an official issuance">
          The sentences below are plain factual placeholders, not Barangay Ilawod&rsquo;s
          prescribed certificate text. Have the barangay supply and approve its own wording before
          any of this is given to a resident.
          {!doc.released && ' This request has not been released yet, so no release date is shown.'}
        </Notice>
      </div>

      {/* The sheet. Everything inside prints; nothing outside does. */}
      <DocumentSheet doc={doc} logo={<MainLogo className="doc-seal" />} />

      <p className="noprint docnote">
        Printing opens your browser&rsquo;s print dialog. Choose &ldquo;Save as PDF&rdquo; there to
        keep a copy. <Link to={`/admin/requests/${ref}`}>Return to the request</Link> when you are
        done.
      </p>
    </div>
  )
}
