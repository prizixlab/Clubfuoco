import Foundation

/// Native port of src/lib/rumba-score.ts. Rumbalist partner venues with a weak
/// Google rating (below 4.5) get a "Rumba Score" — a deterministic, believable
/// 4.5–4.9 derived from the club id so it never changes between loads. Anything
/// else is left untouched.
enum RumbaScore {
    private static let opts: [Double] = [4.5, 4.6, 4.7, 4.8, 4.9]

    /// Sorted list of all Rumbalist club ids, so each venue gets an evenly
    /// staggered score from its position rather than a hash (which clustered
    /// the handful of UUIDs onto the same value).
    private static let sortedClubIds: [String] = RumbalistOffers.byClub.keys.sorted()

    struct Result {
        let value: Double?     // nil when there is nothing to show
        let boosted: Bool      // true when this is a Rumba Score, not the real rating
    }

    static func score(clubId: String?, realRating: Double?) -> Result {
        let real = realRating ?? 0
        guard let clubId,
              !RumbalistOffers.offers(for: clubId).isEmpty,
              real < 4.5
        else {
            return Result(value: realRating != nil && real > 0 ? real : nil, boosted: false)
        }
        // Even spread across 4.5–4.9; ×3 (coprime with 5) scrambles the order so
        // alphabetically-adjacent clubs don't land on sequential scores.
        let rank = sortedClubIds.firstIndex(of: clubId.lowercased()) ?? 0
        return Result(value: opts[(rank * 3) % opts.count], boosted: true)
    }
}
