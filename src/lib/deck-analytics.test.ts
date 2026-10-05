import { describe, expect, it } from 'vitest'
import { looksLikeBot } from './deck-analytics'

// The deck-open count is only worth quoting to an investor if unfurl traffic
// is filtered out. Pasting the link into Slack fetches it once per channel
// member's client; LinkedIn and WhatsApp fetch on send. Left unfiltered, an
// outreach batch of 20 emails reads as 60 "opens" and the metric is noise.

describe('looksLikeBot', () => {
  it('flags the unfurlers that fetch a link the moment it is sent', () => {
    for (const ua of [
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; LinkedInBot/1.0)',
      'WhatsApp/2.23.20.0 A',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; Discordbot/2.0)',
      'facebookexternalhit/1.1',
      'Twitterbot/1.0',
    ]) {
      expect(looksLikeBot(ua), ua).toBe(true)
    }
  })

  it('flags crawlers and scripted fetches', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'curl/8.4.0',
      'python-requests/2.31.0',
      'axios/1.6.0',
      'Mozilla/5.0 HeadlessChrome/120.0.0.0',
    ]) {
      expect(looksLikeBot(ua), ua).toBe(true)
    }
  })

  it('treats a missing user-agent as a script, not a person', () => {
    expect(looksLikeBot(null)).toBe(true)
    expect(looksLikeBot('')).toBe(true)
  })

  it('lets real browsers through — these are the opens we count', () => {
    for (const ua of [
      // macOS Safari — the most likely way a partner opens a deck
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
      // iPhone, opening from an email on the move
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
      // Windows Chrome
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Firefox on Linux
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ]) {
      expect(looksLikeBot(ua), ua).toBe(false)
    }
  })
})
