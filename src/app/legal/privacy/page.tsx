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
      '• Account data: name, email address, phone number (must be unique to a single Club Fuoco account), date of birth, self-declared gender (Male, Female, or Prefer not to say) — see "Commission and automated settlement" below — and any profile photo you add.',
      '• Usage data: clubs you view, save, or book; events you open; and the survey and "taste profile" preferences you provide so we can personalise recommendations.',
      '• Social data: friends you add or accept, groups you create or join, and bookings you share with them.',
      '• Transaction data: records of bookings and tickets. Card details are entered directly with our payment providers (Stripe or Apple) and are not stored by Club Fuoco.',
      '• Attendance data: when you have an active booking, the App can record signals that help us tell whether you arrived at the venue — your in-app "I\'m here" check-in, the booking screen being opened near arrival time, a geofence-entry event on the night of the booking (only if you have granted "Always" location), and an optional "did you get in?" answer after the night. Where these signals include your device location, we store only your distance to the venue, never an ongoing location trail. These signals support partner settlement, fraud prevention, and user support.',
      '• Device and technical data: device type, operating system, and app version, used for service operation and basic diagnostics. We do not use third-party advertising identifiers and do not run analytics SDKs.',
      'The App does not read your contacts, photos, microphone, or full calendar. Location is requested for two purposes: (1) on the Explore feed, a one-off foreground reading to sort venues by distance from where you are; (2) for attendance check-in on a booking you made. By default both uses are foreground only — your device sends a one-off reading when you open Explore, tap "I\'m here", or open the active booking screen near arrival time. If you upgrade to "Always" in iOS Settings, the App also registers a small geofence (~200 m) around each upcoming venue, active only on the night of the booking, so iOS can wake the App long enough to record your arrival automatically; we do not run any continuous background location tracking, do not log raw coordinates between bookings, and do not build a movement profile. You can revert to foreground-only or revoke location entirely at any time in Settings → Privacy → Location. If you grant write-only calendar access to add a group night, the App only creates the event you asked for — it cannot read your existing calendar.',
      'When you sign up, the App makes a single pre-flight call to check whether the phone number you entered is already linked to another account. This check returns only a yes/no answer — no phone numbers belonging to other users are ever exposed.',
    ],
  },
  {
    heading: 'How we use your data',
    body: [
      'We use your data to: create and manage your account; show and personalise venue and event recommendations; process bookings and tickets; settle per-head commission with the venues you attend (see "Commission and automated settlement" below); send service messages and notifications you have enabled; keep the App secure; and comply with legal obligations.',
    ],
  },
  {
    heading: 'Commission and automated settlement',
    body: [
      'Venues that work with Club Fuoco pay us a per-head commission for guests who arrive through the App. The rate is set by each venue and may vary by guest category — including, in some cases, by self-declared gender. This calculation runs automatically based on the gender you declared at signup and is used only to settle the commission between Club Fuoco and the venue. It does not affect what you pay, does not affect your access, and does not produce any legal or similarly significant effect on you under GDPR Article 22. Selecting "Prefer not to say" defaults to the higher of the applicable rates, so opting out of disclosure never disadvantages you.',
      'Gender is used only for this settlement and for aggregate reporting to venues. It is not used for marketing, for profile visibility to other users, for content or feed recommendations, or for any other purpose. You can change your gender selection at any time in Settings → Personal.',
    ],
  },
  {
    heading: 'Legal bases (GDPR)',
    body: [
      'We process personal data under the following legal bases: performance of our contract with you (providing the App, bookings, and verifying that you arrived at a venue you booked); your consent (gender disclosure at signup; push notifications; calendar write access; location for nearby discovery and attendance check-in; optional personalisation — each of which you can withdraw at any time by editing your profile in Settings or by denying / revoking the relevant device permission); our legitimate interests (improving and securing the App, preventing booking and settlement fraud, calculating per-head settlement with venues); and compliance with legal obligations.',
    ],
  },
  {
    heading: 'Who we share data with',
    body: [
      'We do not sell your personal data. We share it only with service providers ("processors") who act on our instructions, and with venues where necessary to deliver a service you requested:',
      '• Supabase — authentication, database, and hosting of your account data.',
      '• Stripe — payment processing for bookings, event tickets, and VIP guestlist purchases.',
      '• Apple — Apple Sign-In authentication when you choose it, and generation of Apple Wallet passes for your bookings.',
      '• Google — Google Sign-In authentication, when you choose it.',
      '• Vercel — hosting of our API and web pages.',
      '• Partner venues and event organisers — booking, guest list, and ticket details needed to admit you or fulfil your reservation; the fact and date of your arrival at a venue you booked (without raw coordinates) and the corresponding per-head commission, for settlement reconciliation.',
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
      'Raw attendance signals (location-bearing check-ins, passive presence pings, geofence-entry events, post-entry answers) are retained for up to 12 months from the booking date and then deleted. The rolled-up attendance status and the per-head commission record on the booking itself are kept alongside the booking record so we can resolve disputes and partner settlement after the fact.',
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
      updated="23 June 2026"
      intro="This policy explains what personal data Club Fuoco collects, why, how it is used and shared, and the rights you have over it."
      sections={SECTIONS}
    />
  )
}
