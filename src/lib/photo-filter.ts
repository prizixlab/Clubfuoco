/**
 * Photo filter — previously called Gemini Vision to strip non-bar photos
 * from hotel venues. Gemini has been removed from the backend; this module
 * is kept as a stable import surface for callers (`/api/places/details`,
 * `/api/admin/sync`) but the filter is now a no-op pass-through.
 *
 * If we want photo filtering back later, do it without a network call —
 * e.g. a heuristic on the photo's aspect ratio + Google Places `photoReference`
 * attribution, or a small on-device classifier.
 */

/**
 * Pass-through. Returns the input photo URL list unchanged.
 */
export async function filterHotelPhotos(photoUrls: string[]): Promise<string[]> {
  return photoUrls
}

/**
 * Returns true if the Google Place types array indicates a hotel/lodging venue.
 * Still useful for callers that branch on hotel-ness — kept as a pure helper.
 */
export function isHotel(types: string[]): boolean {
  return types.includes('lodging')
}
