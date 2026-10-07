import { describe, expect, it } from 'vitest'
import { allowedSenders, decodeHtml, inboxAddress, isAllowedSender, isAuthenticated, newInboxToken, parseTicketEmail, senderDomain, tokenFromRecipients, kindFromPdf, settleFromFeed } from './ticket-inbox'

// Shaped on the real Fourvenues guestlist email (Opium, Jet Lag, 1 Oct 2026).
const HTML = `
<h1>You're in! Guest list confirmed for Jet Lag</h1>
<p>Hello Yakov! We can't wait to see you at Opium Barcelona on <a>October 1, 2026</a>.</p>
<p>Download your QR code below</p>
<div><span>October 1, 2026</span><span>11:30 PM - 05:00 AM</span>
<span>LISTA FREE HASTA LA 1</span><span>Valid for 1 person</span>
<span>Passeig Marítim de la Barceloneta, 34, 08003 Barcelona</span></div>
<a href="https://connector-service.fourvenues.com/tickets/trbl6ewfypmbjzk3zag6p46lck6oo24c/listas-LNKO1S1G1.pdf">Download</a>
<a href="https://connector-service.fourvenues.com/wallet/trbl6ewfypmbjzk3zag6p46lck6oo24c.pkpass">Add to Apple Wallet</a>
`

describe('parseTicketEmail', () => {
  it('reads the door code from the PDF filename', () => {
    const p = parseTicketEmail("You're in! Guest list confirmed for Jet Lag", HTML, '')
    expect(p.codes).toEqual(['LNKO1S1G1'])
    expect(p.eventCode).toBe('LNKO')
    expect(p.pdfUrls).toEqual([
      'https://connector-service.fourvenues.com/tickets/trbl6ewfypmbjzk3zag6p46lck6oo24c/listas-LNKO1S1G1.pdf',
    ])
  })

  it('reads the event, night, party size and kind', () => {
    const p = parseTicketEmail("You're in! Guest list confirmed for Jet Lag", HTML, '')
    expect(p.eventName).toBe('Jet Lag')
    expect(p.night).toBe('2026-10-01')
    expect(p.heads).toBe(1)
    expect(p.isGuestlist).toBe(true)
  })

  it('reads a Spanish date', () => {
    const p = parseTicketEmail('Entrada para Ku Fridays', 'el 2 de octubre de 2026 · Válido para 3 personas', '')
    expect(p.night).toBe('2026-10-02')
    expect(p.heads).toBe(3)
  })

  it('finds nothing in an email that is not a ticket', () => {
    const p = parseTicketEmail('Newsletter', '<p>Promo this weekend</p>', '')
    expect(p.codes).toEqual([])
    expect(p.eventCode).toBeNull()
  })

  it('de-duplicates a link that appears twice', () => {
    const p = parseTicketEmail('x', HTML + HTML, '')
    expect(p.codes).toEqual(['LNKO1S1G1'])
  })
})

describe('tokenFromRecipients', () => {
  it('matches our domain, bare or display-named, any case', () => {
    expect(tokenFromRecipients(['k7q2xw9pab@tickets.clubfuoco.com'])).toBe('k7q2xw9pab')
    expect(tokenFromRecipients(['Yakov <K7Q2XW9PAB@Tickets.ClubFuoco.com>'])).toBe('k7q2xw9pab')
  })
  it('ignores other domains and malformed tokens', () => {
    expect(tokenFromRecipients(['k7q2xw9pab@clubfuoco.com'])).toBeNull()
    expect(tokenFromRecipients(['a-b@tickets.clubfuoco.com'])).toBeNull()
  })
})

describe('tokens', () => {
  it('are 12 chars of the unambiguous alphabet and round-trip through the address', () => {
    const t = newInboxToken()
    expect(t).toMatch(/^[a-km-np-z2-9]{12}$/)
    expect(tokenFromRecipients([inboxAddress(t)])).toBe(t)
  })
})

describe('decodeHtml', () => {
  it('unwraps a base64 data URI', () => {
    const b64 = Buffer.from('<b>hi</b>').toString('base64')
    expect(decodeHtml(`data:text/html;charset=utf-8;base64,${b64}`)).toBe('<b>hi</b>')
  })
  it('leaves plain html alone', () => {
    expect(decodeHtml('<b>hi</b>')).toBe('<b>hi</b>')
  })
})

describe('sender checks', () => {
  it('reads the sender domain from a display-named address', () => {
    expect(senderDomain('Opium Barcelona <no-reply@Mail.Fourvenues.com>')).toBe('mail.fourvenues.com')
    expect(senderDomain('bare@fourvenues.com')).toBe('fourvenues.com')
    expect(senderDomain('nonsense')).toBeNull()
  })
  it('allows the domain and its subdomains, never a lookalike', () => {
    const allowed = allowedSenders(undefined)
    expect(isAllowedSender('fourvenues.com', allowed)).toBe(true)
    expect(isAllowedSender('mail.fourvenues.com', allowed)).toBe(true)
    expect(isAllowedSender('evilfourvenues.com', allowed)).toBe(false)
    expect(isAllowedSender('fourvenues.com.evil.io', allowed)).toBe(false)
    expect(isAllowedSender('gmail.com', allowed)).toBe(false)
  })
  it('reads the allow-list from env, with @ and spaces tolerated', () => {
    expect(allowedSenders(' fourvenues.com, @sendgrid.net ')).toEqual(['fourvenues.com', 'sendgrid.net'])
  })
  it('needs DMARC, or SPF and DKIM together', () => {
    expect(isAuthenticated({ dmarc: 'pass' })).toBe(true)
    expect(isAuthenticated({ spf: 'pass', dkim: 'pass', dmarc: 'fail' })).toBe(true)
    expect(isAuthenticated({ spf: 'pass', dkim: 'fail', dmarc: 'fail' })).toBe(false)
    expect(isAuthenticated(null)).toBe(false)
  })
})

describe('kindFromPdf / settleFromFeed', () => {
  const ev = {
    code: 'XBQO', night: '2026-10-05', venue: 'Opium Barcelona',
    products: [
      { source: 'guestlist', settle: 'free', price: 0, name: 'LISTA GRATIS ANTES 01H' },
      { source: 'guestlist', settle: 'door', price: 15, name: 'LISTA 15€ CON COPA' },
      { source: 'ticket', settle: 'online', price: 20, name: 'Entrada + copa' },
      { source: 'zone', settle: 'table', price: 300, name: 'VIP' },
    ],
  }
  it('reads the kind off the PDF name', () => {
    expect(kindFromPdf('https://connector-service.fourvenues.com/tickets/ab/listas-XBQO19.pdf')).toBe('list')
    expect(kindFromPdf('https://connector-service.fourvenues.com/tickets/ab/reservas-XBQO2.pdf')).toBe('table')
    expect(kindFromPdf('https://x/other.pdf')).toBeNull()
  })
  it('a named product decides an ambiguous list', () => {
    expect(settleFromFeed(ev, 'list', 'Your ticket: LISTA 15€ con copa — see you')).toEqual({ settle: 'door', price: 15 })
  })
  it('refuses to guess when the lists disagree and none is named', () => {
    expect(settleFromFeed(ev, 'list', 'Guest list confirmed')).toBeNull()
  })
  it('an unambiguous kind needs no name', () => {
    expect(settleFromFeed(ev, 'table', '')).toEqual({ settle: 'table', price: 300 })
    expect(settleFromFeed(ev, 'ticket', '')).toEqual({ settle: 'online', price: 20 })
  })
})
