// Shared ticket types and constants — imported by both the events route and tickets route

export const TICKET_MARKUP = 0.10

export interface ExternalEvent {
  id:            string
  platform:      'ra' | 'eventbrite' | 'dice' | 'xceed' | 'songkick' | 'generic'
  title:         string
  venue_name:    string
  date:          string
  start_time:    string | null
  image:         string | null
  base_price:    number        // cents
  display_price: number        // cents after markup
  currency:      string
  platform_url:  string
  sold_out:      boolean
  venue_matched: boolean       // true = event is at this exact venue
}
