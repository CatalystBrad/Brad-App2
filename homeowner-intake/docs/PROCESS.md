# A new process for collecting property information

## The problem, measured

The TA6 6th edition (2025) is 20 pages and 116 fields. Encoded as data with a
realistic time estimate per field, answering it cold takes **about 110 minutes**
— and not 110 easy minutes: it asks for the year the boiler went in, whether a
neighbour has ever complained, where the stopcock is, and whether a tree has a
preservation order.

That is why the form sits on the table. It is not laziness and it is not the
seller being difficult. It is a two-hour task with no natural starting point,
requiring documents from three different drawers, handed to someone who is also
moving house.

Everything below follows from one decision: **stop asking for two hours, and
start asking for ninety seconds.**

## The five changes that matter

### 1. Don't ask what you can look up

Fifteen of the 116 fields are answerable from public or purchasable data before
the seller is contacted at all: title register, EPC register, flood risk,
listed-building and conservation-area status, water company by postcode, Ofcom
broadband availability. Those become **one-tap confirmations**, not questions:

> Is this the correct address?
> We have: **12 Example Street, Leeds, LS1 1AA**
> [ That's right ] [ Not quite ] [ I'll check ]

Confirmed data is stored as the seller's own answer, with the audit trail showing
it was pre-filled and confirmed. Unconfirmed pre-fill is *never* counted as
answered — it is our guess, not their word, and a buyer relies on their word.

An electricity bill photographed once answers supplier, MPAN and meter location
together. The same trick works for gas and for the boiler service sticker.

### 2. Don't ask what doesn't apply

The form has heavy conditional structure that paper cannot express. Ticking "no
solar panels" should skip eight questions; ticking "no alterations" should skip
five. Encoded properly, a typical house with no solar, no septic tank and no
disputes faces **about 65 items rather than 116** — roughly 30 minutes, not 110.

A seller who *does* have an extension, a loft conversion and a septic tank gets
more questions than the paper form would show them, which is correct: those are
the questions that actually matter to their buyer.

### 3. Size the session to the gap in someone's day

The seller sets it and can change it from any message: **1, 3 or 5 questions, or
a 5- or 10-minute slot**; daily, weekdays, every other day or weekly; mornings,
lunchtime or evenings; WhatsApp, text, email or "don't message me, I'll come to
the link".

Two rules make this work in practice:

- **A follow-up is always asked, even past the budget.** A bare "Yes" to "have
  there been any disputes?" with no detail is worse than no answer, because the
  form looks complete when it is not.
- **Questions stay grouped by topic.** Three questions about boundaries is one
  mental context. One about boundaries, one about drains and one about insurance
  is three.

The app is honest about the size of the job: *"26 more sittings, about 26 days at
one a day"*. A seller who wants it finished faster can see exactly what to change.

### 4. Separate the answers from the paperwork

The single biggest cause of delay is not unanswered questions, it is missing
certificates — FENSA, building regs, boiler service, guarantees. Chasing those
inside the question flow blocks everything behind them.

So they run as a **separate track**: a photo-a-day list, phrased as an action
rather than a request for a document. *"Photograph the sticker inside the boiler
door."* A photo sent to the WhatsApp thread lands on the file automatically. The
progress bar for questions and the progress bar for paperwork are different bars,
and neither blocks the other.

### 5. Make silence a signal, not a stalemate

Nudging harder does not work. The system does the opposite: each ignored nudge
**slows** the cadence and then **changes channel** — WhatsApp, then text, then
email, then a task for a human to ring them. Three ignored messages is not a
seller who needs a fourth message; it is a seller who needs a different approach.

Nothing is ever sent outside their chosen hours. PAUSE stops everything for a
week. If an exchange deadline is approaching and there is more form left than
time, the schedule compresses to fit — and says so.

## Why WhatsApp, and what it cannot do

Brad's instinct is right: people are on their phones, and a WhatsApp message gets
read where an email does not. But the platform has hard rules that shape the
product, and it is better to design around them than discover them:

- **Free-form messages are only allowed for 24 hours after the seller's last
  message.** Outside that window, only a pre-approved template can open the
  thread. So the pattern is: template nudge → seller replies → the 24-hour window
  opens → questions flow freely inside it. Four templates cover the whole
  process (invite, resume, paperwork, deadline) and need submitting to Meta for
  approval.
- **Three reply buttons, 20 characters each. Or a list of ten rows, 24
  characters each.** Yes/No/I'll check fits. A ten-option list fits. Anything
  wider does not, and neither do free-text answers with good UX.
- So: **WhatsApp for the taps, the web app for the typing.** Anything long, any
  multi-select, any upload, any correction gets a one-line message with a magic
  link. Same form, same session, no re-authentication.
- **A reply that isn't clearly an answer is never guessed at.** "The wobbly one
  next to the shed" gets a numbered list back, not a stored answer. A wrong
  answer on a TA6 is a misrepresentation claim waiting to happen.
- Opt-out must be honoured immediately and permanently. STOP switches the case to
  web-only and tells the conveyancer.

## Magic links, not passwords

A seller will not create an account to fill in a form once. So: a signed link,
30 days, no password. Practical details that matter:

- The token is **stored only as a hash**, like a password — a leaked database
  does not open everyone's form.
- **Answering links are reusable** (they get scrolled past and come back to for
  weeks). **Sign-off links are single-use and short-lived.**
- Links are revocable, for the "I've lost my phone" call.
- An expired link shows a plain-English page and an invitation to reply for a new
  one, not an error.

## Keeping it legally sound

This is the part that makes it sellable to conveyancers rather than just nice for
sellers.

- **Every answer is versioned**, with who gave it, when, on which channel, from
  what IP. A buyer can claim against a seller for a wrong TA6 answer; the firm
  needs to show exactly what was said and when.
- **Pre-filled data is flagged as such** until confirmed, and the trail shows the
  confirmation.
- **Every owner on the title signs.** The form is not complete until all have.
- **Changing an answer after sign-off un-signs the form** and re-opens it. The
  buyer must receive the version the seller actually stands behind.
- **Gaps are stated, not hidden.** The export leads with what is outstanding and
  what is parked, because an incomplete form that looks complete is worse than an
  obviously incomplete one.
- *Not known* is offered explicitly everywhere it is a proper answer, and the
  help text says so. Sellers guess when they feel they have to guess.

## What the conveyancer gets

- A live chase list: which cases are blocked, on what, and for how long.
- The finished TA6 in the familiar order, printable to PDF, with the audit trail.
- A `readyToSend` flag that is only true when every applicable question is
  answered, every owner has signed, and nothing is parked.

## Rollout

**Phase 1 — pilot (4–6 weeks).** What is in this repo, plus: real WhatsApp
credentials and four approved templates, one SMS fallback, and the conveyancer
dashboard. Run it on 20 live files alongside the current process. Measure one
thing: **days from instruction to a complete TA6.** That is the number that
sells this to a firm.

**Phase 2 — the prefill that saves the most time.** Title register, EPC and flood
data first: they cover the most fields for the least integration work. Bill OCR
after that.

**Phase 3 — the rest of the pack.** TA10 (fittings and contents) is the same
machinery with a different question bank and would take days, not weeks. TA7 for
leasehold is bigger but the same shape.

**Phase 4 — where the real value is.** Once the answers are structured data
rather than a PDF, the buyer's solicitor can be sent structured data too. That is
the direction the whole sector is moving (Land Registry digitisation, upfront
material information under the NTSELAT guidance). A firm holding clean structured
property data is in a much better position than one holding scanned forms.

## The honest risks

- **Licensing.** TA6 is Law Society copyright. Get the licence before launch.
- **WhatsApp template approval** can take days and templates can be rejected. Build
  the SMS and email paths early enough that the pilot is not hostage to it.
- **Per-message cost.** WhatsApp business-initiated conversations are charged.
  At one nudge a day for three weeks that is small per case, but model it.
- **A seller who answers in 90-second bursts gives shorter answers.** Watch the
  free-text quality in the pilot; if it drops, the fix is prompting for specifics
  in the follow-up, not a longer form.
- **The drip could make a fast seller slower.** Anyone who wants to sit down and
  do the lot in one go must be able to — "keep going" is always on screen, and
  the cadence setting goes up to whatever they like.
