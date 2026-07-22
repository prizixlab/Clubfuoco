import LegalDoc, { type LegalSection } from '../../_doc'

/*
 * Promoter Terms — the B2B counterpart to /legal/terms (which stays the
 * consumer document). Separate because the relationship is different in kind:
 * promoters are paid, are reviewed before publishing, and RECEIVE PERSONAL
 * DATA ABOUT GUESTS. That last point is the reason this document exists and
 * cannot just be a variant of the consumer terms.
 *
 * Linked from the Promoters app → You → Settings → Support & legal, and
 * entered in App Store Connect for the FuocoPromoters app record.
 *
 * HAVE A LAWYER REVIEW BEFORE RELYING ON THIS. Specifically:
 *   - the guest-data clause takes a position on controller roles under GDPR;
 *   - the payout and fee clauses move money in both directions between a US
 *     entity and EU-based promoters;
 *   - "False offers" fixes a sum per affected guest. It is drafted as
 *     liquidated damages, with a stated rationale and a cap, because a clause
 *     that reads as a PENALTY is unenforceable under the Wyoming law this
 *     document chooses, and a Spanish court can moderate a cláusula penal it
 *     considers disproportionate. The wording matters to whether it works.
 */

const SECTIONS: LegalSection[] = [
  {
    heading: 'Who these Terms are for',
    body: [
      'These Promoter Terms of Service ("Terms") govern your use of the Club Fuoco Promoters application and the promoter tools within it (the "Promoter App"), operated by Club Fuoco, a corporation organized under the laws of the State of Wyoming, United States, with registered office at 30 N Gould St Ste R, Sheridan, WY 82801, USA ("Club Fuoco", "we", "us").',
      'These Terms apply to you as a business or professional user — a promoter, brand, collective, or offer supplier working with venues. They are separate from the Club Fuoco consumer Terms of Use, which govern the guest-facing Club Fuoco app. If you also use the consumer app as a guest, that use is governed by the consumer Terms and the consumer Privacy Policy.',
      'By applying for a promoter account, or by using the Promoter App, you confirm that you accept these Terms. If you do not agree, do not use the Promoter App.',
    ],
  },
  {
    heading: 'Eligibility and approval',
    body: [
      'You must be at least 18 years old and legally able to enter into a contract. If you are acting for a company, collective, or brand, you confirm that you are authorised to bind it, and "you" means both you and that entity.',
      'Promoter accounts are not open by default. You apply from within the app, and we review each application. Approval is at our sole discretion, and we may decline an application without giving reasons, ask for further information, or approve an account for a limited scope.',
      'We may also revoke promoter status later — for example where the information you gave was inaccurate, where you no longer work with the venues you listed, or where you breach these Terms. Revocation does not affect payouts already earned and undisputed.',
    ],
  },
  {
    heading: 'Your account and your brand',
    body: [
      'You must give accurate information when you register and keep it current. You are responsible for everything done under your account and for keeping your credentials secure. Do not share one account between people who should be accountable separately.',
      'Your brand name, logo, and bio are your public identity. Where your account has a public brand, that name and logo are shown to guests in the consumer Club Fuoco app, on offers, on booking confirmations, and on Apple Wallet passes issued for your nights.',
      'You confirm that you own or are licensed to use any name, logo, image, or other material you upload, and that it does not infringe anyone else\'s rights. You grant Club Fuoco a non-exclusive, worldwide, royalty-free licence to host, reproduce, resize, re-render, and display that material for the purpose of operating and promoting the service. That licence ends when you remove the material or close your account, except for copies already embedded in issued passes, confirmations, and records we must retain.',
      'You may close your account from Settings → Delete account. We may suspend or terminate accounts that breach these Terms.',
    ],
  },
  {
    heading: 'Nights, events, and offers you publish',
    body: [
      'The Promoter App lets you create nights and events, allocate guest-list spots, and — where your account supports it — publish commercial offers such as free guest lists or VIP tables to guests in the consumer app.',
      'What you publish must be true. In particular, you must have the venue\'s authorisation for any night, guest list, or offer you list at that venue, and the terms you state — entry price, what is included, valid days, dress code, capacity — must be terms you can actually honour on the night.',
      'Submissions are reviewed. New and edited nights, events, and offers may be held for review before they become visible to guests, and a change to a published item may return it to review. We may reject, edit for clarity, unpublish, or suspend anything that is inaccurate, misleading, unlawful, unsafe, offensive, or that we cannot verify with the venue. We aim to review promptly but do not guarantee a turnaround time.',
      'Publication is not an endorsement, and we do not warrant that any night or offer will reach a particular number of guests.',
    ],
  },
  {
    heading: 'Honouring what you publish',
    body: [
      'If a guest arrives holding a confirmation, a guest-list place, or an offer issued through Club Fuoco, you must honour it on the terms shown to that guest, subject to the venue\'s lawful admission rules (capacity, age, dress code, safety, and refusal of entry for conduct).',
      'If a night is cancelled, moved, or materially changed, tell us and update it in the app as early as you reasonably can so guests can be notified.',
      'Repeatedly failing to honour published terms is a material breach of these Terms and may result in unpublishing, suspension, withholding of disputed payouts, or termination.',
    ],
  },
  {
    heading: 'False offers',
    body: [
      'An offer is false where you publish it without the venue\'s authorisation, where you knew or ought reasonably to have known it could not be honoured on the night, or where the terms actually applied at the door are materially worse than the terms shown to the guest in the Club Fuoco app.',
      'Where you publish a false offer, we reserve the right to charge you EUR 50 for each affected guest. An affected guest is a person who signed up through Club Fuoco in reliance on that offer and who was then refused it, or admitted only on materially worse terms, on the night it was valid.',
      'This amount is a genuine pre-estimate of the loss a false offer causes us, not a punishment. A guest turned away at a door holding a Club Fuoco confirmation costs us the goodwill of that guest, the support handling to make it right, any refund or compensation we choose to offer them, and damage to the trust the service depends on. Those losses are real but awkward to quantify per guest, which is why they are fixed in advance at a single figure.',
      'This does not apply where the offer was genuine and the failure was operational or outside your control. In particular it does not apply where the venue was at capacity, where entry was lawfully refused for age, dress code, conduct, or safety, where the night was cancelled or changed and you updated it in the app as early as you reasonably could, or where performance was prevented by an event outside your control.',
      'Process. Before charging anything we will tell you which offer and which guests are affected, give you our evidence, and give you 14 days to respond. We will not charge for a guest you show was not in fact refused the published terms. Any amount that remains due after that may be invoiced through Stripe or set off against payouts owed to you. The total we may charge in respect of any single night is capped at EUR 2,000.',
      'We do not currently charge this amount. This clause exists so that we may introduce the charge without amending these Terms. Before we begin charging we will notify you in the app at least 30 days in advance and publish the activation date, and we will apply it only to offers published after that date.',
      'This is separate from, and in addition to, our right to unpublish an offer, withhold a disputed payout, or suspend or terminate your account for repeatedly failing to honour published terms.',
    ],
  },
  {
    heading: 'Earnings, payouts, and fees',
    body: [
      'Two separate flows of money can exist on a promoter account, and they are accounted for separately.',
      '• Payouts to you. For private nights with payout tracking, you earn an agreed amount per attending guest, at the rate recorded on the allocation for that night. Where your account sells paid offers, revenue from those sales is also reported to you in Earnings. Figures shown in the app are our records and are provisional until the night is reconciled — attendance, no-shows, and door refusals can change them.',
      '• Fees you pay us. Front-page promotion is a paid placement, billed through our payment provider, Stripe. Nothing else is charged for a standard promoter account. If your balance falls past due, promotion is paused until it is settled; your existing nights and guest lists continue to work.',
      'You are responsible for your own taxes, social contributions, invoicing, and any licences or permits your promotional activity requires. Nothing in these Terms creates an employment relationship, partnership, or agency between you and Club Fuoco. You are an independent contractor.',
      'If you believe a payout figure is wrong, contact partners@clubfuoco.com within 60 days of the night in question. We will review our records with the venue. We may withhold a payout we reasonably believe is connected to fraudulent attendance, fabricated guests, or manipulated check-ins, while we investigate.',
      'We may also set off against payouts owed to you any amount you owe us under "False offers" above, once the process in that clause has been followed.',
    ],
  },
  {
    heading: 'Guest data — your obligations',
    body: [
      'This is the most important clause in these Terms. To run a door, the Promoter App shows you personal data about real people: guest names, party sizes, any note attached to a booking, and check-in status.',
      'That data is disclosed to you for one purpose only: admitting those guests to the specific night they signed up for, and reconciling attendance for that night. You must not use it for anything else. In particular you must not:',
      '• contact, market to, or add guests to any mailing, messaging, or broadcast list;',
      '• export, copy, photograph, or transfer guest data to any system outside the Promoter App, except a temporary door list for the night itself;',
      '• retain guest data after the night beyond what you need to resolve a dispute, and in any case no longer than is lawful;',
      '• share guest data with any third party, including the venue, other promoters, or your own staff, except staff working that specific door who need it to admit guests;',
      '• re-identify, enrich, profile, or combine guest data with other sources.',
      'Where you use guest data only as described above and only within the Promoter App, you act on our instructions. If you use guest data for any other purpose, you do so as an independent controller under applicable data protection law, you take on the obligations of a controller for that use, and you are responsible for it.',
      'You must keep guest data confidential, apply reasonable security to any device you view it on, and tell us without undue delay — and in any event within 24 hours — at privacy@clubfuoco.com if guest data you hold is lost, exposed, or accessed by anyone who should not have it.',
      'Misuse of guest data is a material breach. It may result in immediate termination, and you indemnify Club Fuoco against claims, fines, and costs arising from your misuse of guest data.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: [
      'You must not: fabricate guests, allocations, or check-ins; inflate attendance to increase a payout; create duplicate or nominee accounts to obtain placements or payouts; misrepresent your relationship with a venue; upload anything unlawful, discriminatory, or that infringes third-party rights; or attempt to access data belonging to other promoters, venues, or guests.',
      'You must not probe, scrape, reverse-engineer, or interfere with the Promoter App or its APIs, or use them other than through the app as provided.',
      'Admission decisions must comply with applicable anti-discrimination law. You must not refuse entry on the basis of a protected characteristic.',
    ],
  },
  {
    heading: 'Notifications',
    body: [
      'The Promoter App can send push notifications about your account — for example when a night or offer is approved or rejected, or when a guest joins a list. These are operational messages tied to your account. You can disable them at any time in iOS Settings, but doing so may mean you miss time-sensitive review or door information.',
    ],
  },
  {
    heading: 'Availability and changes to the service',
    body: [
      'We work to keep the Promoter App available but do not guarantee uninterrupted or error-free operation. We may change, suspend, or discontinue features, and may perform maintenance, with or without notice.',
      'Attendance detection, check-in, and reporting are best-effort. A missed or late detection does not by itself establish that a guest did or did not attend; we reconcile with the venue where a night is disputed.',
    ],
  },
  {
    heading: 'Liability',
    body: [
      'Club Fuoco is a platform connecting promoters, venues, and guests. We are not the operator of any venue, not the organiser of your nights, and not responsible for what happens at them — including admission decisions, safety, licensing, conduct of guests or staff, or disputes between you and a venue.',
      'To the fullest extent permitted by law, we exclude liability for indirect or consequential loss, and for lost profits, lost revenue, lost bookings, or lost goodwill. Our total liability to you arising out of or in connection with these Terms in any 12-month period is limited to the greater of (a) the total fees you paid us in that period and (b) EUR 500.',
      'Nothing in these Terms limits liability that cannot be limited by law, including for fraud, or for death or personal injury caused by negligence.',
      'You indemnify Club Fuoco against claims, losses, fines, and reasonable costs arising from your breach of these Terms, your misuse of guest data, your nights and offers, or your relationship with any venue.',
    ],
  },
  {
    heading: 'Suspension and termination',
    body: [
      'You may stop using the Promoter App at any time and delete your account from Settings. We may suspend or terminate your access immediately where you materially breach these Terms, where we are required to by law, or where we reasonably believe continued access presents a risk to guests, venues, or the service.',
      'On termination, your public brand, nights, and offers stop being shown to guests. Payouts already earned and undisputed remain payable. Clauses that by their nature should survive — guest data, liability, indemnity, and governing law — survive termination.',
    ],
  },
  {
    heading: 'Governing law and disputes',
    body: [
      'These Terms are governed by the laws of the State of Wyoming, United States, without regard to its conflict-of-laws rules, and the courts of that state have jurisdiction.',
      'If you are established in the European Union and are acting as a business, this choice of law and forum does not deprive you of the protection of mandatory provisions of the law of your country of establishment that cannot be derogated from by agreement.',
    ],
  },
  {
    heading: 'Changes and contact',
    body: [
      'We may update these Terms. We will update the "Last updated" date above and, where the change is material, notify you in the app. Continuing to use the Promoter App after a change means you accept the updated Terms.',
      'For anything about your promoter account, payouts, or these Terms, contact partners@clubfuoco.com. For privacy questions and guest-data incidents, contact privacy@clubfuoco.com.',
    ],
  },
]

export default function PromoterTermsPage() {
  return (
    <LegalDoc
      kicker="Club Fuoco Promoters · Legal"
      title="Promoter Terms of Service"
      updated="22 July 2026"
      intro="These Terms govern promoter and partner accounts on Club Fuoco — how nights and offers are published, how payouts and fees work, and the obligations that come with handling guest data. They are separate from the Terms that govern the guest-facing Club Fuoco app."
      sections={SECTIONS}
    />
  )
}
