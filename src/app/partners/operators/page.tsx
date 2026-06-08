import PartnerSubpage from '../../_web/PartnerSubpage'

export default function OperatorsPage() {
  if (process.env.BUILD_TARGET === 'ios') return null
  return (
    <PartnerSubpage
      eyebrow="For Operators"
      headline="For the people who run Barcelona nights."
      lede="Promoters and table operators who own these nights: manage guest lists and VIP tables in one place, reach guests who actually show, and settle in one feed."
      deal={[
        { title: 'One dashboard, multiple venues', body: 'Guest lists and tables across every room you operate.' },
        { title: 'A direct line to real guests',   body: 'Repeat customers who showed up last weekend, not anonymous accounts.' },
        { title: 'Clean settlement',               body: 'Bookings, fees, payouts in one place. Audit-ready every Sunday.' },
      ]}
      howItWorks={[
        { title: 'Add your nights',  body: 'Per-venue, per-night guest lists and VIP tables.' },
        { title: 'We fill them',     body: 'Curated guests with confirmed bookings, paid up front where applicable.' },
        { title: 'You run the night',body: 'We handle the booking; you handle the door.' },
      ]}
      pullQuote="The night isn’t run by venues. It’s run by the operators who fill them. Build for the operator and the venue side takes care of itself."
      audience="Operator / promoter"
    />
  )
}
