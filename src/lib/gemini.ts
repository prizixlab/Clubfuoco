// Gemini AI client — used for venue classification and content analysis

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

export interface VenueClassification {
  is_nightlife:  boolean
  confidence:    number        // 0.0 – 1.0
  reasoning:     string        // short explanation
  suggested_tags: string[]     // from the approved tag list
}

const APPROVED_TAGS = [
  'nightclub', 'bar', 'lounge', 'rooftop', 'cocktail_bar', 'restaurant',
  'techno', 'house', 'latin', 'hip_hop', 'indie', 'electronic', 'jazz', 'live_music',
  'upscale', 'budget', 'mid_range', 'beach_club', 'terrace', 'speakeasy',
]

/**
 * Ask Gemini whether a Google Places venue is a nightlife spot.
 * Sends name, address, types, rating, and optionally a photo URL.
 */
export async function classifyVenue(params: {
  name:          string
  address:       string
  types:         string[]
  rating?:       number | null
  ratings_total?: number
  price_level?:  number | null
  photo_url?:    string | null
}): Promise<VenueClassification> {
  const { name, address, types, rating, ratings_total, price_level, photo_url } = params

  const textPrompt = `You are the venue curator for Club Fuoco — a premium, curated nightlife app for Barcelona. Club Fuoco is NOT a directory of every place that serves a drink. It features only genuine nightlife destinations: places you get dressed up for and go to at night.

BELONGS in Club Fuoco (is_nightlife = true):
- Nightclubs, discotecas, DJ-driven venues
- Cocktail bars and craft-cocktail lounges
- Rooftop bars and terrace bars with a real scene
- Beach clubs
- Lounges, late-night live-music venues, speakeasies
- Any bar that is a genuine, atmospheric night-out destination

Does NOT belong (is_nightlife = false):
- Restaurants, cafés, bakeries, fast food, food courts
- Plain daytime bars, sleepy neighbourhood bars, basic vermut or tapas bars
- Ordinary sports bars and Irish pubs with no nightlife scene
- Hotel lobby bars with no scene
- Anything primarily a daytime or food venue, or simply mundane

Look hard at the PHOTO: does it look like a night-out destination — atmospheric lighting, energy, a dressed-up crowd, design — or like an ordinary café / bar / restaurant?

Venue:
- Name: ${name}
- Address: ${address}
${types.length ? `- Google category types: ${types.join(', ')}\n` : ''}- Rating: ${rating ?? 'unknown'} (${ratings_total ?? 0} reviews)
- Price level: ${price_level !== null && price_level !== undefined ? `${price_level}/4` : 'unknown'}

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "is_nightlife": true or false,
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence max 20 words explaining your decision",
  "suggested_tags": ["tag1", "tag2"]
}

Only use tags from this approved list: ${APPROVED_TAGS.join(', ')}
"is_nightlife" means "belongs in Club Fuoco". "confidence" is how sure you are of that verdict (0=unsure, 1=certain).`

  // Build the request — add photo if available (vision)
  const parts: any[] = [{ text: textPrompt }]

  if (photo_url) {
    try {
      // Fetch the image and convert to base64 for Gemini vision
      const imgRes = await fetch(photo_url)
      if (imgRes.ok) {
        const buf    = await imgRes.arrayBuffer()
        const base64 = Buffer.from(buf).toString('base64')
        const mime   = imgRes.headers.get('content-type') ?? 'image/jpeg'
        parts.push({ inline_data: { mime_type: mime, data: base64 } })
      }
    } catch { /* skip photo if it fails */ }
  }

  const res = await fetch(GEMINI_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature:     0.1,   // low temp = consistent classification
        maxOutputTokens: 512,
        // Disable thinking for simple classification — faster + cheaper on free tier
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Gemini API error: ${res.status} ${errBody.slice(0, 200)}`)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

  // Parse JSON response — strip any accidental markdown fences
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    const parsed = JSON.parse(clean)
    return {
      is_nightlife:  Boolean(parsed.is_nightlife),
      confidence:    Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
      reasoning:     String(parsed.reasoning ?? '').slice(0, 150),
      suggested_tags: (parsed.suggested_tags ?? []).filter((t: string) => APPROVED_TAGS.includes(t)),
    }
  } catch {
    // If JSON parse fails, fall back to a safe default
    return { is_nightlife: false, confidence: 0, reasoning: 'Parse error', suggested_tags: [] }
  }
}
