import LegalDoc, { type LegalSection } from '../_doc'

/*
 * NOTE FOR THE TEAM — replace [support@clubfuoco.app] and the concierge
 * contact below with your real support channels before submitting.
 */

const SECTIONS: LegalSection[] = [
  {
    heading: 'Contacting us',
    body: [
      'For any question, issue, or feedback, email our team at [support@clubfuoco.app]. We aim to reply within 1–2 business days.',
      'Sapphire and Black members can also reach the concierge directly through the contact shown on their membership screen.',
    ],
  },
  {
    heading: 'Bookings and tickets',
    body: [
      'You can review your bookings and ticket orders at any time from the "My Bookings" screen.',
      'Cancellation, refund, and no-show rules are set by each venue or event organiser and are shown before you confirm a purchase. If something looks wrong with an order, contact us with your booking reference and we will help.',
    ],
  },
  {
    heading: 'Managing your membership',
    body: [
      'Membership tiers (Gold, Sapphire, Black) are auto-renewable subscriptions billed through your Apple ID.',
      'To change or cancel a membership, open the iOS Settings app, tap your name, then Subscriptions, and select Club Fuoco. Cancelling stops future renewals; you keep access until the end of the current period. Deleting the app does not cancel a subscription.',
      'If you previously subscribed and the app does not show your membership, open any membership tier and tap "Restore purchases".',
    ],
  },
  {
    heading: 'Refunds',
    body: [
      'Refunds for membership subscriptions are handled by Apple. Request one at reportaproblem.apple.com.',
      'Refunds for bookings and event tickets follow each venue or organiser’s policy — contact us and we will assist.',
    ],
  },
  {
    heading: 'Your account',
    body: [
      'You can update your profile, manage notifications, and delete your account from the Settings screen.',
      'Deleting your account removes your personal data as described in our Privacy Policy.',
    ],
  },
  {
    heading: 'Trouble signing in',
    body: [
      'If you cannot sign in, make sure you are using the email address you registered with, and check your internet connection. You can reset your password from the login screen. If you are still stuck, email [support@clubfuoco.app].',
    ],
  },
]

export default function HelpPage() {
  return (
    <LegalDoc
      kicker="Club Fuoco · Support"
      title="Help & Support"
      updated="16 May 2026"
      intro="Answers to common questions about bookings, memberships, and your account — and how to reach us if you need more help."
      sections={SECTIONS}
    />
  )
}
