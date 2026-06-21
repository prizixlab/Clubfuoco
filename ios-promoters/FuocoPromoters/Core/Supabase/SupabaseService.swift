import Foundation
import Supabase

final class SupabaseService: @unchecked Sendable {
    static let shared = SupabaseService()

    static let supabaseURL = URL(string: "https://nqviodkapzjdkbgknauo.supabase.co")!
    static let anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdmlvZGthcHpqZGtiZ2tuYXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTE2MjIsImV4cCI6MjA5MzY4NzYyMn0.CygsWuRRUQY4e7OzX8VYlaaWfoQO6K9KWZP_StGEr18"

    let client: SupabaseClient

    init() {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601

        client = SupabaseClient(
            supabaseURL: Self.supabaseURL,
            supabaseKey: Self.anonKey,
            options: SupabaseClientOptions(
                db: .init(encoder: encoder, decoder: decoder)
            )
        )
    }
}
