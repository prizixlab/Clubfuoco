import SwiftUI

/// A country code paired with its dialing prefix, flag, and the maximum number
/// of national digits (excluding the dial code) — used to cap input length.
struct Country: Identifiable, Hashable {
    let name: String
    let flag: String
    let dialCode: String   // e.g. "+34"
    let digits: Int        // max national number length, e.g. Spain 9, US 10
    var id: String { name + dialCode }

    /// Curated list, Spain first (Barcelona-based audience). Sorted-by-length
    /// matching in PhoneNumberField handles overlapping prefixes (e.g. +1).
    static let all: [Country] = [
        Country(name: "Spain",          flag: "🇪🇸", dialCode: "+34",  digits: 9),
        Country(name: "United Kingdom", flag: "🇬🇧", dialCode: "+44",  digits: 10),
        Country(name: "France",         flag: "🇫🇷", dialCode: "+33",  digits: 9),
        Country(name: "Germany",        flag: "🇩🇪", dialCode: "+49",  digits: 11),
        Country(name: "Italy",          flag: "🇮🇹", dialCode: "+39",  digits: 10),
        Country(name: "Portugal",       flag: "🇵🇹", dialCode: "+351", digits: 9),
        Country(name: "Ireland",        flag: "🇮🇪", dialCode: "+353", digits: 9),
        Country(name: "Netherlands",    flag: "🇳🇱", dialCode: "+31",  digits: 9),
        Country(name: "Belgium",        flag: "🇧🇪", dialCode: "+32",  digits: 9),
        Country(name: "Switzerland",    flag: "🇨🇭", dialCode: "+41",  digits: 9),
        Country(name: "Austria",        flag: "🇦🇹", dialCode: "+43",  digits: 13),
        Country(name: "Sweden",         flag: "🇸🇪", dialCode: "+46",  digits: 9),
        Country(name: "Norway",         flag: "🇳🇴", dialCode: "+47",  digits: 8),
        Country(name: "Denmark",        flag: "🇩🇰", dialCode: "+45",  digits: 8),
        Country(name: "Finland",        flag: "🇫🇮", dialCode: "+358", digits: 10),
        Country(name: "Poland",         flag: "🇵🇱", dialCode: "+48",  digits: 9),
        Country(name: "Czechia",        flag: "🇨🇿", dialCode: "+420", digits: 9),
        Country(name: "Greece",         flag: "🇬🇷", dialCode: "+30",  digits: 10),
        Country(name: "Romania",        flag: "🇷🇴", dialCode: "+40",  digits: 9),
        Country(name: "United States",  flag: "🇺🇸", dialCode: "+1",   digits: 10),
        Country(name: "Canada",         flag: "🇨🇦", dialCode: "+1",   digits: 10),
        Country(name: "Mexico",         flag: "🇲🇽", dialCode: "+52",  digits: 10),
        Country(name: "Brazil",         flag: "🇧🇷", dialCode: "+55",  digits: 11),
        Country(name: "Argentina",      flag: "🇦🇷", dialCode: "+54",  digits: 10),
        Country(name: "Colombia",       flag: "🇨🇴", dialCode: "+57",  digits: 10),
        Country(name: "Morocco",        flag: "🇲🇦", dialCode: "+212", digits: 9),
        Country(name: "U.A.E.",         flag: "🇦🇪", dialCode: "+971", digits: 9),
        Country(name: "Australia",      flag: "🇦🇺", dialCode: "+61",  digits: 9),
    ]

    /// Dial codes longest-first, so "+351" wins over "+3" when matching a prefix.
    static let byDialLengthDesc: [Country] = all.sorted { $0.dialCode.count > $1.dialCode.count }
}

/// Phone input with a country-code selector. Binds to a single string stored as
/// "<dialCode> <national number>" (e.g. "+34 612 345 678").
struct PhoneNumberField: View {
    @Binding var phone: String
    /// Right-align the number field for use inside Form/LabeledContent rows.
    var trailing = false

    @State private var dialCode = "+34"
    @State private var national = ""
    @State private var parsed = false

    var body: some View {
        HStack(spacing: trailing ? 6 : 10) {
            Menu {
                ForEach(Country.all) { country in
                    Button {
                        dialCode = country.dialCode
                        national = String(national.prefix(country.digits))  // re-cap for the new country
                        recombine()
                    } label: {
                        Text("\(country.flag)  \(country.name)  \(country.dialCode)")
                    }
                }
            } label: {
                HStack(spacing: 3) {
                    Text(selectedFlag)
                    Text(dialCode)
                        .font(.cfSans(16))
                        .foregroundStyle(Theme.ink)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Theme.fadedSand)
                }
            }

            TextField(placeholder, text: Binding(
                get: { national },
                set: { input in
                    // Keep digits only, capped to this country's max length.
                    national = String(input.filter(\.isNumber).prefix(maxDigits))
                    recombine()
                }
            ))
            .keyboardType(.phonePad)
            .textContentType(.telephoneNumber)
            .font(.cfSans(16))
            .multilineTextAlignment(trailing ? .trailing : .leading)
            .frame(maxWidth: trailing ? nil : .infinity, alignment: trailing ? .trailing : .leading)
        }
        .onAppear {
            guard !parsed else { return }
            parse()
            // Guarantee the bound value carries the dial code, so the country
            // code is always saved with the number — even if the user submits
            // a pre-filled/legacy number without re-touching the field.
            if !national.isEmpty { recombine() }
            parsed = true
        }
    }

    private var selectedFlag: String {
        Country.all.first { $0.dialCode == dialCode }?.flag ?? "🏳️"
    }

    private var maxDigits: Int {
        Country.all.first { $0.dialCode == dialCode }?.digits ?? 15
    }

    /// A grey example with exactly `maxDigits` digits, grouped in threes (a
    /// trailing single digit is merged into the previous group).
    private var placeholder: String {
        let sample = Array("612345678901234".prefix(maxDigits))
        var groups: [String] = []
        var i = 0
        while i < sample.count {
            groups.append(String(sample[i..<min(i + 3, sample.count)]))
            i += 3
        }
        if let last = groups.last, last.count == 1, groups.count > 1 {
            groups[groups.count - 2] += groups.removeLast()
        }
        return groups.joined(separator: " ")
    }

    /// Rebuild the bound value from the picked code + typed number.
    private func recombine() {
        let trimmed = national.trimmingCharacters(in: .whitespaces)
        phone = trimmed.isEmpty ? "" : "\(dialCode) \(trimmed)"
    }

    /// Split an existing value into a known dial code + the remaining number.
    private func parse() {
        let raw = phone.trimmingCharacters(in: .whitespaces)
        guard raw.hasPrefix("+") else {
            if !raw.isEmpty { national = raw }   // no code stored — keep as national
            return
        }
        let compact = raw.replacingOccurrences(of: " ", with: "")
        if let match = Country.byDialLengthDesc.first(where: { compact.hasPrefix($0.dialCode) }) {
            dialCode = match.dialCode
            national = String(compact.dropFirst(match.dialCode.count))
        } else {
            national = raw
        }
    }
}
