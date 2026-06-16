import LegalDoc, { type LegalSection } from '../_doc'

/*
 * Controller is Club Fuoco (Wyoming corporation). This policy must also be
 * hosted at a public URL and entered in App Store Connect → App Privacy.
 * Have a lawyer / DPO review for GDPR — a US entity processing EU-user data.
 */

const SECTIONS: LegalSection[] = [
  {
    heading: 'Who we are',
    body: [
      'Club Fuoco is a nightlife discovery and membership app. The data controller is Club Fuoco, a corporation organized under the laws of the State of Wyoming, United States, with registered office at 30 N Gould St Ste R, Sheridan, WY 82801, USA.',
      'For any privacy question, or to exercise your rights, contact us at privacy@clubfuoco.com.',
    ],
  },
  {
    heading: 'Data we collect',
    body: [
      '• Account data: name, email address, date of birth, and any profile photo you add.',
      '• Usage data: clubs you view, save, or book; events you open; membership tier; and the survey and "taste profile" preferences you provide so we can personalise recommendations.',
      '• Social data: friends you add or accept, groups you create or join, and bookings you share with them.',
      '• Transaction data: records of bookings, tickets, and memberships. Card details are entered directly with our payment providers (Stripe or Apple) and are not stored by Club Fuoco.',
      '• Attendance data: when you have an active booking, the App can record signals that help us tell whether you arrived at the venue — your in-app "I\'m here" check-in, the booking screen being opened near arrival time, and an optional "did you get in?" answer after the night. Where these signals include your device location, we store only your distance to the venue, never an ongoing location trail. These signals support partner settlement, fraud prevention, and user support.',
      '• Device and technical data: device type, operating system, and app version, used for service operation and basic diagnostics. We do not use third-party advertising identifiers and do not run analytics SDKs.',
      'The App does not read your contacts, photos, microphone, or full calendar. Location is requested only when you explicitly tap "I\'m here" on an active booking, or when you open the active booking screen near arrival time — never in the background. If you grant write-only calendar access to add a group night, the App only creates the event you asked for — it cannot read your existing calendar.',
    ],
  },
  {
    heading: 'How we use your data',
    body: [
      'We use your data to: create and manage your account; show and personalise venue and event recommendations; process bookings, tickets, and memberships; provide membership benefits at partner venues; send service messages and notifications you have enabled; keep the App secure; and comply with legal obligations.',
    ],
  },
  {
    heading: 'Legal bases (GDPR)',
    body: [
      'We process personal data under the following legal bases: performance of our contract with you (providing the App, bookings, and memberships, including verifying that you arrived at a venue you booked); your consent (optional notifications, optional calendar write access, optional location for attendance check-in, and optional personalisation — which you can withdraw at any time by denying or revoking the relevant device permission); our legitimate interests (improving and securing the App, preventing booking and settlement fraud); and compliance with legal obligations.',
    ],
  },
  {
    heading: 'Who we share data with',
    body: [
      'We do not sell your personal data. We share it only with service providers ("processors") who act on our instructions, and with venues where necessary to deliver a service you requested:',
      '• Supabase — authentication, database, and hosting of your account data.',
      '• Stripe — payment processing for bookings, event tickets, and VIP guestlist purchases.',
      '• Apple — billing and management of iOS membership subscriptions (in-app purchases) and Apple Sign-In; generation of Apple Wallet passes for bookings and memberships.',
      '• Google — Google Sign-In authentication, when you choose it.',
      '• Vercel — hosting of our API and web pages.',
      '• Partner venues and event organisers — booking, guest list, and ticket details needed to admit you or fulfil your reservation.',
      'We may also disclose data where required by law or to protect our rights, users, or the public.',
    ],
  },
  {
    heading: 'International transfers',
    body: [
      'Some of our providers may process data outside the European Economic Area. Where that happens, we rely on appropriate safeguards such as the European Commission’s Standard Contractual Clauses to protect your data.',
    ],
  },
  {
    heading: 'How long we keep data',
    body: [
      'We keep your personal data for as long as your account is active. If you delete your account, we delete or anonymise your personal data within a reasonable period, except where we must retain certain records (for example, transaction records) to meet legal or accounting obligations.',
      'Raw attendance signals (location-bearing check-ins, passive presence pings, post-entry answers) are retained for up to 12 months from the booking date and then deleted; the rolled-up attendance status on the booking itself is kept alongside the booking record so we can resolve disputes and partner settlement after the fact.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'Subject to applicable law, you have the right to access, correct, delete, or export your personal data; to object to or restrict certain processing; and to withdraw consent at any time.',
      'You can delete your account directly from the Settings screen. To exercise any other right, contact privacy@clubfuoco.com. You also have the right to lodge a complaint with your local data protection authority — in Spain, the Agencia Española de Protección de Datos (AEPD).',
    ],
  },
  {
    heading: 'Data storage on your device',
    body: [
      'The App stores a session token and limited cached data on your device so you stay signed in and the App loads quickly. You can clear this by signing out or deleting the App.',
    ],
  },
  {
    heading: 'Children',
    body: [
      'The App is intended for adults aged 18 and over. We do not knowingly collect personal data from anyone under 18. If you believe a minor has provided us data, contact us and we will delete it.',
    ],
  },
  {
    heading: 'Security',
    body: [
      'We use technical and organisational measures to protect your data, including encryption in transit and access controls. No system is completely secure, but we work to protect your information and to respond promptly to any incident.',
    ],
  },
  {
    heading: 'Changes and contact',
    body: [
      'We may update this Privacy Policy from time to time. We will post the updated version in the App and update the "Last updated" date above.',
      'For any privacy question, or to exercise your rights, contact privacy@clubfuoco.com.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <LegalDoc
      kicker="Club Fuoco · Legal"
      title="Privacy Policy"
      updated="16 June 2026"
      intro="This policy explains what personal data Club Fuoco collects, why, how it is used and shared, and the rights you have over it."
      sections={SECTIONS}
    />
  )
}
