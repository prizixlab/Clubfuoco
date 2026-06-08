import PartnerSubpage from '../../_web/PartnerSubpage'

export default function TicketingPage() {
  if (process.env.BUILD_TARGET === 'ios') return null
  return (
    <PartnerSubpage
      eyebrow="For Ticketing Platforms"
      headline="Your inventory, our curated surface."
      lede="Bring your Barcelona events into a discovery feed built for nightlife. We handle curation and demand. You keep fulfilment and your existing flow."
      deal={[
        { title: 'Focused distribution', body: 'Your events surfaced to users who go out in this city, not generic event-listing browsers.' },
        { title: 'Real attribution',     body: 'Every sale tracked back to Club Fuoco. Settlement and reporting in one feed.' },
        { title: 'No platform fight',    body: 'Your checkout, your pass, your flow. We send the buyer; you finish the sale.' },
      ]}
      howItWorks={[
        { title: 'Connect your feed',        body: 'API, RSS, or a flat export — whatever your platform supports.' },
        { title: 'We surface what fits',     body: 'Curated to match the user’s night, not dumped wholesale.' },
        { title: 'They tap, they buy, you fulfil', body: 'Standard affiliate flow with first-class UX on our side.' },
      ]}
      pullQuote="Ticketing platforms have demand problems. We have a feed that puts the right show in front of the right person. That’s the whole deal."
      audience="Ticketing platform"
    />
  )
}
