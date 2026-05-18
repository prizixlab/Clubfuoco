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
    heading: 'Memberships and subscriptions',
    body: [
      'Club Fuoco offers paid membership tiers (Gold, Sapphire, Black) as auto-renewable monthly subscriptions.',
      '• On iOS, memberships are sold and billed by Apple through your Apple ID. Payment is charged at confirmation of purchase. The subscription renews automatically each month unless cancelled at least 24 hours before the end of the current period.',
      '• You can view, manage, or cancel a membership at any time in your Apple ID subscription settings. Deleting the App does not cancel a subscription.',
      '• Membership benefits (such as discounts, priority entry, and guest list access) apply only at participating partner venues and are subject to availability and each venue’s policies.',
      'Refunds for Apple-billed subscriptions are handled by Apple in accordance with the App Store terms. We do not control and cannot issue those refunds.',
      'Membership benefits — including partner clubs, discounts, guest passes, concierge access, and event access — are not fixed or guaranteed. They may be added, changed, reduced, or removed at any time. By subscribing to and continuing to use a paid membership, you acknowledge and accept that the specific benefits available may change over time.',
      'For any increase in the subscription price, or a material reduction in benefits, we will give you advance notice and the opportunity to cancel before the change takes effect, as required by applicable consumer-protection law and the App Store rules.',
    ],
  },
  {
    heading: 'Bookings, tickets and payments',
    body: [
      'The App lets you book venue entry, reserve tables, and purchase event tickets. These are real-world goods and services provided by venues and event organisers, not by Club Fuoco.',
      'Payments for bookings and tickets are processed by our payment provider, Stripe. Club Fuoco is not the merchant of the underlying venue service and does not guarantee admission, which remains at the venue’s discretion.',
      'Cancellation, refund, and no-show rules for bookings and tickets are set by the relevant venue or organiser and shown at the time of purchase.',
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
      'You agree not to misuse the App. In particular you must not: use it for any unlawful purpose; attempt to gain unauthorised access to it; interfere with its operation; resell or transfer membership benefits, guest passes, or bookings except as expressly permitted; or submit false, abusive, or infringing content.',
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
      updated="17 May 2026"
      intro="Please read these Terms carefully. They set out the rules for using the Club Fuoco app, including memberships, bookings, and ticket purchases."
      sections={SECTIONS}
    />
  )
}
