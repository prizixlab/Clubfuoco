import PartnerSubpage from '../../_web/PartnerSubpage'

export default function VenuesPage() {
  if (process.env.BUILD_TARGET === 'ios') return null
  return (
    <PartnerSubpage
      eyebrow="For Venues"
      headline="Fill the right rooms on the right nights."
      lede="Club Fuoco puts your capacity in front of a curated, high-intent local audience — and confirms entry before they leave home. You stay in control of your night."
      deal={[
        { title: 'Real demand',         body: 'Listings shown to users who plan their night the same week, not random tourists.' },
        { title: 'Confirmed bookings',  body: 'Every guest pays or commits before arrival. Fewer no-shows, cleaner doors.' },
        { title: 'You keep the door',   body: 'We clear the guest. You decide who walks in, who waits, who’s denied. Always.' },
      ]}
      howItWorks={[
        { title: 'List in minutes',           body: 'Add your rooms, tables, and guest lists to the dashboard.' },
        { title: 'We drive traffic',          body: 'Featured placement based on availability, dress code, music, and your house rules.' },
        { title: 'Guests show up confirmed',  body: 'They arrive with a pass on their phone. You scan, they enter.' },
      ]}
      pullQuote="The best venues in Barcelona don’t need more visibility. They need the right night. We work hard to send them the people they actually want."
      audience="Venue"
    />
  )
}
