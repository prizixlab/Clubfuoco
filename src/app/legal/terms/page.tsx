import LegalDoc, { type LegalSection } from '../_doc'

/*
 * Entity details below are Club Fuoco (Wyoming corporation, filed 18 May 2026).
 * Have a lawyer review before launch — note the cross-border angle: a US entity
 * operating an app for EU (Barcelona) users.
 */

const SECTIONS: LegalSection[] = [
  {
    heading: 'Acceptance of these Terms',
    body: [
      'These Terms of Use ("Terms") govern your use of the Club Fuoco mobile application and related services (the "App"), operated by Club Fuoco, a corporation organized under the laws of the State of Wyoming, United States, with registered office at 30 N Gould St Ste R, Sheridan, WY 82801, USA ("Club Fuoco", "we", "us").',
      'By creating an account or using the App you confirm that you accept these Terms. If you do not agree, do not use the App.',
    ],
  },
  {
    heading: 'Eligibility',
    body: [
      'The App is intended for adults. You must be at least 18 years old to create an account and to book or attend nightlife venues through the App.',
      'Creating an account requires a valid email address, a phone number not already linked to another Club Fuoco account, and a self-declared gender (Male, Female, or Prefer not to say). Gender is required so we can settle commissions with venues that pay different per-head rates by guest category — see "How Club Fuoco makes money" below.',
      'You are responsible for ensuring that your use of the App, and entry to any venue, complies with local law and the venue’s own age and admission policies.',
    ],
  },
  {
    heading: 'Your account',
    body: [
      'You must provide accurate information when registering and keep it up to date. You are responsible for all activity that occurs under your account and for keeping your login credentials secure.',
      'You may close your account at any time from the Settings screen. We may suspend or terminate accounts that breach these Terms.',
    ],
  },
  {
    heading: 'How Club Fuoco makes money',
    body: [
      'Club Fuoco is free to use. We make money from venues that pay us a per-head commission for guests who arrive through the App. The applicable rate is set by each venue and may vary by guest category — including, in some cases, by self-declared gender.',
      'The commission is paid by the venue to Club Fuoco. The user pays nothing additional. The commission rate has no effect on the price the venue charges you, has no effect on access or admission, and has no effect on which venues or events appear in your feed. If you decline to disclose gender at signup ("Prefer not to say"), settlement defaults to the higher of the applicable rates, so opting out never disadvantages you.',
    ],
  },
  {
    heading: 'Bookings, tickets and payments',
    body: [
      'The App lets you book venue entry, reserve tables, and purchase event tickets. These are real-world goods and services provided by venues and event organisers, not by Club Fuoco.',
      'Payments for bookings and tickets are processed by our payment provider, Stripe. Club Fuoco is not the merchant of the underlying venue service and does not guarantee admission, which remains at the venue’s discretion.',
      'Cancellation, refund, and no-show rules for bookings and tickets are set by the relevant venue or organiser and shown at the time of purchase.',
      'Reserved right to charge a no-show fee. Bookings made through Club Fuoco hold capacity at the venue. To protect that capacity, we reserve the right to charge a no-show fee of up to €50 per ticket when a confirmed booking is not honoured — that is, when no member of the party arrives at the venue on the booking date, no arrival is detected via the in-app check-in or geofence, and the booking was not cancelled before the cancellation window closes. This clause applies only to paid bookings; free guest-list signups (such as rumba list) are not subject to any no-show fee.',
      'We do not currently charge this fee. This clause exists so we may introduce no-show fees in future without amending these Terms. Before we begin charging, we will: notify you in-app at least 30 days in advance; publish the activation date and the exact fee amount (within the €50 cap above) in an updated version of these Terms; and apply the fee only to bookings made after the activation date.',
      'If we do begin charging, the fee will be processed to the payment method used for the original booking. You will receive a receipt by email and may dispute the charge by contacting support within 14 days. We will not charge the fee where you provide reasonable evidence that the venue refused entry on grounds outside your control (capacity, dress-code change after booking, venue closure), or where attendance was prevented by an event outside your control.',
    ],
  },
  {
    heading: 'Arrival check-in',
    body: [
      'When you grant the App location permission, we may detect your arrival at a venue you have booked — either automatically via a small geofence on the night of the booking (if you grant "Always" location) or via the in-app "I\'m here" button (in either permission mode).',
      'Detection is best-effort and not guaranteed. A missed detection does not invalidate your booking and does not relieve you of any cancellation policy. The venue\'s door admission decision is always final.',
    ],
  },
  {
    heading: 'Notifications',
    body: [
      'The App requests permission to send push notifications on first launch. Today we use this only for operational messages tied to bookings you make — including a single review prompt the morning after a night out. We do not send marketing pushes. If we ever introduce marketing notifications, they will require separate opt-in. You can disable notifications at any time in iOS Settings.',
    ],
  },
  {
    heading: 'Partner venues and third-party content',
    body: [
      'The App displays information about venues and events sourced from venues, event organisers, and third-party services. We work to keep this accurate but do not warrant that it is complete, current, or error-free.',
      'Club Fuoco is not responsible for the conduct, safety, services, or admission decisions of any venue or organiser.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: [
      'You agree not to misuse the App. In particular you must not: use it for any unlawful purpose; attempt to gain unauthorised access to it; interfere with its operation; resell or transfer guest passes or bookings except as expressly permitted; or submit false, abusive, or infringing content.',
      'We may remove content and suspend access where we reasonably believe these Terms have been breached.',
    ],
  },
  {
    heading: 'Intellectual property',
    body: [
      'The App, its design, branding, and content (excluding third-party and venue content) are owned by Club Fuoco or its licensors. We grant you a personal, non-exclusive, non-transferable, revocable licence to use the App for its intended purpose. No other rights are granted.',
    ],
  },
  {
    heading: 'Disclaimers and liability',
    body: [
      'The App is provided "as is" and "as available". To the fullest extent permitted by law, we exclude implied warranties.',
      'Nothing in these Terms limits liability that cannot be limited by law, including liability for death or personal injury caused by negligence, or for fraud. Subject to that, Club Fuoco is not liable for indirect or consequential loss, or for the acts of venues, organisers, or other users.',
      'Your statutory rights as a consumer are not affected by these Terms.',
    ],
  },
  {
    heading: 'Apple App Store terms',
    body: [
      'These Terms are between you and Club Fuoco only, not with Apple. Apple is not responsible for the App or its content.',
      'Apple has no obligation to provide maintenance or support for the App. Apple is not responsible for any product warranties or for addressing any claims relating to the App (including product liability, legal or regulatory non-compliance, or consumer protection claims).',
      'Apple, and Apple’s subsidiaries, are third-party beneficiaries of these Terms and may enforce them against you.',
      'You confirm that you are not located in a country subject to a U.S. Government embargo or designated as "terrorist supporting", and that you are not on any U.S. Government list of prohibited or restricted parties.',
    ],
  },
  {
    heading: 'Changes to these Terms',
    body: [
      'We may update these Terms from time to time. We will post the updated version in the App and update the "Last updated" date. Continued use of the App after changes take effect constitutes acceptance.',
    ],
  },
  {
    heading: 'Governing law and contact',
    body: [
      'These Terms are governed by the laws of the State of Wyoming, United States, without affecting any mandatory consumer-protection rights you have under the law of your country of residence.',
      'Questions about these Terms: legal@clubfuoco.com. Our Privacy Policy explains how we handle your personal data and forms part of your agreement with us.',
    ],
  },
]

export default function TermsPage() {
  return (
    <LegalDoc
      kicker="Club Fuoco · Legal"
      title="Terms of Use"
      updated="23 June 2026"
      intro="Please read these Terms carefully. They set out the rules for using the Club Fuoco app, including signup, bookings, ticket purchases, and arrival check-in."
      sections={SECTIONS}
    />
  )
}
