import LegalDoc, { type LegalSection } from '../../_doc'

/*
 * Promoter Privacy Policy — the B2B counterpart to /legal/privacy.
 *
 * Written against what the Promoters app actually does, not the consumer app:
 * no location, no camera, no contacts, no calendar (the Info.plist declares no
 * usage-description keys at all), and no phone number at signup. The photo
 * picker is the out-of-process PHPicker, which grants no library access. If any
 * of that changes, this document has to change with it — and so does the App
 * Privacy answers in App Store Connect.
 *
 * Section 04 is the one that has no analogue in the consumer policy: promoters
 * RECEIVE guest personal data, so their role has to be explained here and
 * their obligations are set in the Promoter Terms, clause 07.
 *
 * HAVE A LAWYER / DPO REVIEW — a US entity processing EU personal data, with a
 * controller-role position taken in section 04.
 */

const SECTIONS: LegalSection[] = [
  {
    heading: 'Who we are and what this covers',
    body: [
      'This policy explains how Club Fuoco handles personal data about promoters and partners who use the Club Fuoco Promoters app (the "Promoter App"). The data controller is Club Fuoco, a corporation organized under the laws of the State of Wyoming, United States, with registered office at 30 N Gould St Ste R, Sheridan, WY 82801, USA.',
      'This is a separate document from the Club Fuoco consumer Privacy Policy. This one is about data we hold about YOU as a promoter. Data we hold about guests — the people who book and attend nights — is covered by the consumer Privacy Policy at clubfuoco.com/legal/privacy. If you also use the consumer app as a guest, that policy applies to your guest account.',
      'For any privacy question, or to exercise your rights, contact privacy@clubfuoco.com.',
    ],
  },
  {
    heading: 'Data we collect about you',
    body: [
      '• Account data: your name, email address, and the verification code flow used to sign in. We do not ask promoters for a phone number or a date of birth.',
      '• Application data: the Instagram handle, the clubs or scenes you say you work with, and the optional free-text description of your experience that you submit when applying for a promoter account, together with the outcome of our review and any reason recorded for a rejection.',
      '• Brand and profile data: your brand or promotional name, logo, bio, and Instagram handle, plus your brand colour where your account has a public brand.',
      '• Operational data: the nights, events, guest-list allocations, and offers you create; their review status and history; and attendance and check-in figures for your nights.',
      '• Financial data: payout amounts and status for your nights, revenue recorded against paid offers, and your billing balance. Card details are entered directly with Stripe and are never stored by Club Fuoco.',
      '• Device and technical data: your device push token (so we can notify you about reviews and guest activity), app version, and basic diagnostic information. We do not use third-party advertising identifiers and do not run analytics or advertising SDKs.',
    ],
  },
  {
    heading: 'What the Promoter App does not access',
    body: [
      'The Promoter App does not request or use your location. It does not read your contacts, your calendar, your microphone, or your photo library — when you choose a logo or an event image, iOS shows you a picker that hands the app only the single image you picked, without granting access to the rest of your library.',
      'Push notifications are the only permission the app asks for, and you can decline or revoke it at any time in iOS Settings.',
    ],
  },
  {
    heading: 'Guest data you see — and your role',
    body: [
      'To run a door, the Promoter App shows you personal data about guests: their name, party size, any note on the booking, and whether they have checked in. This is disclosed to you so you can admit those guests to the specific night they signed up for and reconcile attendance for it.',
      'Where you use that data only for that purpose and only within the Promoter App, you are acting on our instructions and we remain the controller. If you use guest data for any other purpose — contacting guests, exporting them, building your own list — you are acting as an independent controller for that use and you take on the responsibilities that come with it.',
      'Your obligations here are set out in clause 07 of the Promoter Terms of Service, and they are binding. In short: use it for the door and nothing else, do not export it, do not market to guests, keep it confidential, and tell us at privacy@clubfuoco.com within 24 hours if it is lost or exposed.',
      'Guests can exercise their own privacy rights against us at any time. If a guest asks us to delete their data, we may require you to delete any copy you hold.',
    ],
  },
  {
    heading: 'How we use your data',
    body: [
      'We use your data to: review your application and operate your promoter account; publish your brand, nights, and offers to guests; run the review workflow and tell you its outcome; calculate and reconcile payouts and billing; send operational notifications; detect and investigate fraudulent attendance, fabricated guests, and manipulated check-ins; keep the service secure; and comply with legal, tax, and accounting obligations.',
      'We do not sell your personal data, and we do not use it for advertising.',
    ],
  },
  {
    heading: 'What is public',
    body: [
      'Your brand name, logo, bio, and brand colour are shown publicly. Where your account has a public brand, they appear to guests in the consumer Club Fuoco app — on offers, on the venue pages where you operate, on booking confirmations, and on Apple Wallet passes issued for your nights. Treat these fields as public.',
      'Your email address, your application answers, your payout figures, and your billing balance are not shown to guests or to other promoters.',
    ],
  },
  {
    heading: 'Legal bases (GDPR)',
    body: [
      'We process your personal data under the following legal bases: performance of our contract with you (operating your promoter account, publishing your nights and offers, paying you); our legitimate interests (reviewing applications, verifying that offers are authorised by the venue, preventing payout and attendance fraud, securing and improving the service); your consent (push notifications, which you can withdraw in iOS Settings); and compliance with legal obligations (tax and accounting records).',
    ],
  },
  {
    heading: 'Who we share data with',
    body: [
      'We share your data only with service providers acting on our instructions, and with venues where it is necessary to run a night you are promoting:',
      '• Supabase — authentication, database, and storage of your account, brand, and operational data, including logos you upload.',
      '• Stripe — billing for paid front-page promotion, and payment processing for paid offers.',
      '• Apple — push notification delivery (APNs), and generation of Apple Wallet passes carrying your brand for guests who book your nights.',
      '• Vercel — hosting of our API and web pages.',
      '• Partner venues — your brand identity and the details of the nights, guest lists, and offers you run with them, plus attendance and settlement figures for reconciliation.',
      'We may also disclose data where required by law or to protect our rights, our users, or the public.',
    ],
  },
  {
    heading: 'International transfers',
    body: [
      'Some of our providers may process data outside the European Economic Area. Where that happens, we rely on appropriate safeguards such as the European Commission’s Standard Contractual Clauses.',
    ],
  },
  {
    heading: 'How long we keep data',
    body: [
      'We keep your account and brand data for as long as your promoter account is active. If you delete your account, we delete or anonymise your personal data within a reasonable period, except where we must keep records to meet legal, tax, or accounting obligations — payout and billing records in particular are retained for the period required by law.',
      'Application records, including a rejection and its recorded reason, are kept so we can handle re-applications and appeals consistently.',
      'Nights, offers, and attendance figures are retained as business records of the venue relationship even after an account closes, and are disassociated from you where we no longer need the link.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'Subject to applicable law, you have the right to access, correct, delete, or export your personal data; to object to or restrict certain processing; and to withdraw consent at any time.',
      'You can edit your brand and profile from the You tab, and delete your account from Settings → Delete account. To exercise any other right, contact privacy@clubfuoco.com. You also have the right to complain to your local data protection authority — in Spain, the Agencia Española de Protección de Datos (AEPD).',
    ],
  },
  {
    heading: 'Data stored on your device',
    body: [
      'The Promoter App stores a session token and limited cached data on your device so you stay signed in and the app loads quickly. Guest lists you have opened may be cached on the device for the night. You can clear all of this by signing out or deleting the app.',
    ],
  },
  {
    heading: 'Security',
    body: [
      'We use technical and organisational measures to protect data, including encryption in transit, access controls, and row-level access rules that limit each promoter account to its own nights, guests, and figures. No system is completely secure, but we work to protect your information and to respond promptly to incidents.',
    ],
  },
  {
    heading: 'Age',
    body: [
      'The Promoter App is for adults working professionally in nightlife. It is not directed at anyone under 18, and we do not knowingly hold promoter data for anyone under 18.',
    ],
  },
  {
    heading: 'Changes and contact',
    body: [
      'We may update this policy. We will post the updated version and change the "Last updated" date above.',
      'For any privacy question, to exercise your rights, or to report a guest-data incident, contact privacy@clubfuoco.com.',
    ],
  },
]

export default function PromoterPrivacyPage() {
  return (
    <LegalDoc
      kicker="Club Fuoco Promoters · Legal"
      title="Promoter Privacy Policy"
      updated="22 July 2026"
      intro="This policy explains what personal data Club Fuoco holds about you as a promoter, why, who it is shared with, and the rights you have over it. It also explains your role when the app shows you personal data about guests."
      sections={SECTIONS}
    />
  )
}
