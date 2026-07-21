import Foundation

/// Native counterpart of src/lib/rumba-score.ts. Deal-partner venues with a
/// weak Google rating (below 4.5) get a "Rumba Score" — a deterministic,
/// believable 4.5–4.9. Anything else is left untouched.
///
/// Membership comes from the LIVE offer catalog (RumbalistOffers.byClub is
/// refreshed from /api/partner at launch, on foreground and on every feed
/// load), never a frozen snapshot of it. The value is derived from the club's
/// OWN id — earlier this used the venue's index in the sorted deal set, which
/// moved every venue's displayed rating whenever an unrelated venue was
/// signed or dropped. An FNV-1a hash keeps the spread across 4.5–4.9 without
/// the char-code clustering that the old summing hash suffered on UUIDs, and
/// is stable regardless of set membership or size.
enum RumbaScore {
    private static let opts: [Double] = [4.5, 4.6, 4.7, 4.8, 4.9]

    struct Result {
        let value: Double?     // nil when there is nothing to show
        let boosted: Bool      // true when this is a Rumba Score, not the real rating
    }

    static func score(clubId: String?, realRating: Double?) -> Result {
        let real = realRating ?? 0
        guard let clubId,
              RumbalistOffers.hasLiveOffer(clubId),
              real < 4.5
        else {
            return Result(value: realRating != nil && real > 0 ? real : nil, boosted: false)
        }
        return Result(value: opts[Int(fnv1a(clubId.lowercased()) % 5)], boosted: true)
    }

    /// 64-bit FNV-1a — mixes every byte, so UUIDs that differ in one hex digit
    /// land on unrelated buckets (unlike summing char codes).
    private static func fnv1a(_ s: String) -> UInt64 {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in s.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return hash
    }
}
