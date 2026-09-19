// The cheapest question is the one you never ask. Everything here is data we
// can get without the seller: they only confirm it with one tap.
//
// Each provider is a stub with the real source named. Swap the body for the
// live call; the rest of the system does not change.
export const PROVIDERS = {
  // HM Land Registry Find Property Information / title register (API, paid).
  hmlr: async ({ postcode, address }) => ({
    '1.1': { value: { address, postcode }, note: 'from the title register' },
    '1.3': { value: null, note: 'proprietor names - needs the title register purchase' },
    '1.5': { value: null, note: 'date of registration' },
  }),
  // Ordnance Survey / OS Places API.
  os_uprn: async () => ({ '1.2': { value: null, note: 'UPRN lookup by address' } }),
  // Historic England listed buildings API (open data).
  historic_england: async () => ({ '5.7': { value: 'No', note: 'no listed entry found at this address' } }),
  // Local authority conservation area data / planning.data.gov.uk (open data).
  conservation_area: async () => ({ '5.8': { value: 'No', note: 'not in a published conservation area' } }),
  // Council TPO register where published - patchy, so default to not known.
  tpo: async () => ({ '5.9': { value: 'Not known', note: 'no published TPO register for this council' } }),
  // Environment Agency flood risk API (open data). Tells the seller what the
  // official rating is before they answer from memory.
  flood_risk: async () => ({ '8.1': { value: null, note: 'EA rating: very low surface water risk' } }),
  // UKradon / UKHSA radon potential by postcode.
  radon: async () => ({ '8.3': { value: null, note: 'postcode is not in a radon affected area' } }),
  // EPC register (open data) - gives main heating fuel and much else.
  epc: async () => ({ '11.4': { value: null, note: 'EPC says: boiler and radiators, mains gas' } }),
  // Water company by postcode (Water UK lookup).
  water_company: async () => ({
    '12.water': { value: null, note: 'supplier resolved from postcode' },
    '12.sewerage': { value: null, note: 'sewerage undertaker resolved from postcode' },
  }),
  // Ofcom broadband and mobile availability API (open data) - buyers ask first.
  broadband_availability: async () => ({ '12.telecoms': { value: null, note: 'Ofcom: ultrafast available, 1000 Mbps' } }),
  // OCR of a photographed bill: supplier, MPAN/MPRN, meter serial.
  bill_ocr: async () => ({}),
};

/**
 * Runs every provider the question bank asks for, writes what comes back as
 * status 'prefilled', and returns the item ids the seller now only has to
 * confirm rather than answer.
 */
export async function applyPrefill(store, caseId) {
  const c = store.getCase(caseId);
  const wanted = new Set(store.bank.questions.map((q) => q.prefill).filter(Boolean));
  const confirmed = [];
  const notes = {};
  for (const name of wanted) {
    const provider = PROVIDERS[name];
    if (!provider) continue;
    let result = {};
    try {
      result = await provider({ postcode: c.postcode, address: c.address, uprn: c.uprn });
    } catch (err) {
      store.event(caseId, 'prefill_failed', { provider: name, error: String(err) });
      continue;
    }
    for (const [itemId, payload] of Object.entries(result)) {
      if (payload.note) notes[itemId] = payload.note;
      if (payload.value == null) continue;        // a note without a value is context, not an answer
      store.saveAnswer(caseId, itemId, { value: payload.value, status: 'prefilled', source: `prefill:${name}` });
      confirmed.push(itemId);
    }
  }
  store.event(caseId, 'prefill_applied', { prefilled: confirmed.length, providers: [...wanted] });
  return { prefilled: confirmed, notes };
}
