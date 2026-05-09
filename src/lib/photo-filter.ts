/**
 * Gemini Vision photo filter for hotel venues.
 *
 * Hotels have photos of rooms, pools, lobbies, etc. mixed in with their bar.
 * This fetches each photo, asks Gemini if it shows a bar/nightclub area,
 * and returns only the ones that do.
 *
 * Only call this when the Google Place types include 'lodging'.
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY!
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

/**
 * Returns true if the photo at `imageUrl` shows a bar, nightclub, lounge,
 * or entertainment/drinking area (rather than a hotel room, pool, lobby, etc.)
 */
async function isBarPhoto(imageUrl: string): Promise<boolean> {
  try {
    // Fetch the image bytes from Google (this runs server-side so CORS is fine)
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) return true // can't fetch → keep by default
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg'
    const buffer   = await imgRes.arrayBuffer()
    const base64   = Buffer.from(buffer).toString('base64')

    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: 'Does this photo show a bar, nightclub, lounge, rooftop bar, or any area primarily for drinking and nightlife? Answer with only "yes" or "no".',
            },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 5, thinkingConfig: { thinkingBudget: 0 } },
      }),
    })

    if (!geminiRes.ok) return true // API error → keep by default
    const geminiData = await geminiRes.json()
    const answer = (geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
      .trim()
      .toLowerCase()

    return answer.startsWith('yes')
  } catch {
    return true // network/parse error → keep by default
  }
}

/**
 * Given a list of raw Google photo URLs, returns only the ones that
 * show a bar or nightclub area according to Gemini Vision.
 *
 * If none pass (e.g. the bar has no photos), returns all originals as a fallback.
 */
export async function filterHotelPhotos(photoUrls: string[]): Promise<string[]> {
  const results = await Promise.all(photoUrls.map(url => isBarPhoto(url)))
  const filtered = photoUrls.filter((_, i) => results[i])
  // Fallback: if Gemini filtered everything out, return originals unchanged
  return filtered.length > 0 ? filtered : photoUrls
}

/**
 * Returns true if the Google Place types array indicates a hotel/lodging venue.
 */
export function isHotel(types: string[]): boolean {
  return types.includes('lodging')
}
