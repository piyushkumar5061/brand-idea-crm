/**
 * Shared Category -> Disposition mapping.
 *
 * The Disposition dropdown MUST be dependent on the Category dropdown:
 *   - New         -> used for leads that have not been contacted yet
 *   - Non-Contact -> couldn't reach the lead on the phone
 *   - Contacted   -> spoke to the lead
 *
 * Keep this file as the single source of truth so the Log Call modal and the
 * full-screen Lead Detail view stay in sync.
 */

export type DispositionCategory = 'new' | 'non_contact' | 'contacted';

export const CATEGORY_LABELS: Record<DispositionCategory, string> = {
  new: 'New',
  non_contact: 'Non-Contact',
  contacted: 'Contacted',
};

export const DISPOSITIONS_BY_CATEGORY: Record<DispositionCategory, string[]> = {
  new: ['new'],
  non_contact: [
    'Did not pick',
    'Switched off',
    'Not reachable',
    'Not in service',
    'Incorrect number',
  ],
  contacted: [
    'Call back',
    'Ready to pay',
    'Ready to join session',
    'After session joined not interested',
    'Not interested (on call)',
    'Deal closed',
  ],
};

/** Dispositions in Contacted that do NOT require a follow-up date/time. */
export const NO_FOLLOWUP_REQUIRED = ['Deal closed', 'Not interested (on call)'];

/** Flat list of every disposition (for filter dropdowns). */
export const ALL_DISPOSITIONS: string[] = [
  ...DISPOSITIONS_BY_CATEGORY.new,
  ...DISPOSITIONS_BY_CATEGORY.non_contact,
  ...DISPOSITIONS_BY_CATEGORY.contacted,
];

/** Reverse lookup: disposition value -> category. */
export function categoryOf(disposition: string | null | undefined): DispositionCategory | '' {
  if (!disposition) return '';
  for (const cat of Object.keys(DISPOSITIONS_BY_CATEGORY) as DispositionCategory[]) {
    if (DISPOSITIONS_BY_CATEGORY[cat].includes(disposition)) return cat;
  }
  return '';
}

/**
 * Normalize phone for wa.me links:
 *   - strip all non-digit chars
 *   - drop leading zeros
 *   - prepend 91 (India) if the result is exactly 10 digits
 */
export function normalizePhoneForWa(raw: string): string {
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) digits = '91' + digits;
  return digits;
}
