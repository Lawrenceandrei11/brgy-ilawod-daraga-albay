// ============================================================
// id-extract — RETIRED
//
// This endpoint used to send a downscaled photograph of a resident's
// government ID to Google's Gemini API, which read the printed fields and
// filled the registration form. Barangay E-Assist no longer does that, by
// anyone's AI or OCR service.
//
// Why it was retired
// ------------------
// The project's Gemini key was on an unpaid tier, and Google's API terms for
// unpaid use say the content you submit is used to improve their products and
// machine-learning technologies, that human reviewers may read it, and -- in
// as many words -- "Do not submit sensitive, confidential, or personal
// information to the Unpaid Services". A photograph of someone's government
// ID is precisely that, and the barangay is its data controller.
//
// The registration flow never needed it. Residents type their details in, the
// photograph goes to the private valid-ids bucket, and an authorised barangay
// officer checks the document by hand -- which was always the real
// verification step. The reader only ever filled blanks faster.
//
// Why this file still exists
// --------------------------
// A stub, not a deletion, and deliberately so. Deleting the function outright
// would answer a browser still running an older bundle with a 404 and a CORS
// failure, which surfaces as an unexplained error. 410 Gone is the honest
// answer -- this existed, it is finished -- and it is readable by the caller.
// Remove the function entirely only once no deployed frontend calls it; see
// supabase/README.md.
//
// What it must never do
// ---------------------
// It does not read the request body, so no ID image is ever received into
// memory. It does not touch GEMINI_API_KEY, reach the network, open a
// database connection, reserve a rate-limit slot, or log anything about the
// caller. There is nothing here to configure and nothing here to leak.
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Written for a resident, because an older bundle will show it to one.
const GONE =
  'Automatic ID reading has been removed. Type your ID details in yourself — your uploaded ID ' +
  'is checked by an authorised barangay officer before your account is approved.'

Deno.serve((req: Request) => {
  // The preflight still has to be answered, or the browser reports a CORS
  // error instead of the message below.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Note what is absent: no req.json(), no Deno.env.get, no fetch, no client.
  // The body is never read, so an image sent by an old bundle is discarded
  // unexamined rather than received.
  return new Response(
    JSON.stringify({ error: GONE, retired: true }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
