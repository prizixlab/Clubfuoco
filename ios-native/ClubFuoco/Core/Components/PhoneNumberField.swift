import SwiftUI

/// A country code paired with its dialing prefix, flag, and the maximum number
/// of national digits (excluding the dial code) — used to cap input length.
struct Country: Identifiable, Hashable {
    let name: String
    let flag: String
    let dialCode: String   // e.g. "+34"
    let digits: Int        // max national number length, e.g. Spain 9, US 10
    var id: String { name + dialCode }

    /// Full country list. The Barcelona-relevant markets lead; everything else
    /// follows alphabetically. `CountryPickerSheet` makes it searchable, and
    /// the length-sorted matcher below resolves overlapping prefixes (+1, +7…).
    static let all: [Country] = [
        Country(name: "Spain", flag: "🇪🇸", dialCode: "+34", digits: 9),
        Country(name: "United Kingdom", flag: "🇬🇧", dialCode: "+44", digits: 10),
        Country(name: "France", flag: "🇫🇷", dialCode: "+33", digits: 9),
        Country(name: "Germany", flag: "🇩🇪", dialCode: "+49", digits: 11),
        Country(name: "Italy", flag: "🇮🇹", dialCode: "+39", digits: 10),
        Country(name: "Portugal", flag: "🇵🇹", dialCode: "+351", digits: 9),
        Country(name: "Ireland", flag: "🇮🇪", dialCode: "+353", digits: 9),
        Country(name: "Netherlands", flag: "🇳🇱", dialCode: "+31", digits: 9),
        Country(name: "Belgium", flag: "🇧🇪", dialCode: "+32", digits: 9),
        Country(name: "Switzerland", flag: "🇨🇭", dialCode: "+41", digits: 9),
        Country(name: "Austria", flag: "🇦🇹", dialCode: "+43", digits: 13),
        Country(name: "Sweden", flag: "🇸🇪", dialCode: "+46", digits: 9),
        Country(name: "Norway", flag: "🇳🇴", dialCode: "+47", digits: 8),
        Country(name: "Denmark", flag: "🇩🇰", dialCode: "+45", digits: 8),
        Country(name: "Finland", flag: "🇫🇮", dialCode: "+358", digits: 10),
        Country(name: "Poland", flag: "🇵🇱", dialCode: "+48", digits: 9),
        Country(name: "Czechia", flag: "🇨🇿", dialCode: "+420", digits: 9),
        Country(name: "Greece", flag: "🇬🇷", dialCode: "+30", digits: 10),
        Country(name: "Romania", flag: "🇷🇴", dialCode: "+40", digits: 9),
        Country(name: "United States", flag: "🇺🇸", dialCode: "+1", digits: 10),
        Country(name: "Canada", flag: "🇨🇦", dialCode: "+1", digits: 10),
        Country(name: "Mexico", flag: "🇲🇽", dialCode: "+52", digits: 10),
        Country(name: "Brazil", flag: "🇧🇷", dialCode: "+55", digits: 11),
        Country(name: "Argentina", flag: "🇦🇷", dialCode: "+54", digits: 10),
        Country(name: "Colombia", flag: "🇨🇴", dialCode: "+57", digits: 10),
        Country(name: "Morocco", flag: "🇲🇦", dialCode: "+212", digits: 9),
        Country(name: "United Arab Emirates", flag: "🇦🇪", dialCode: "+971", digits: 9),
        Country(name: "Australia", flag: "🇦🇺", dialCode: "+61", digits: 9),
        Country(name: "Afghanistan", flag: "🇦🇫", dialCode: "+93", digits: 9),
        Country(name: "Albania", flag: "🇦🇱", dialCode: "+355", digits: 9),
        Country(name: "Algeria", flag: "🇩🇿", dialCode: "+213", digits: 9),
        Country(name: "Andorra", flag: "🇦🇩", dialCode: "+376", digits: 6),
        Country(name: "Angola", flag: "🇦🇴", dialCode: "+244", digits: 9),
        Country(name: "Antigua and Barbuda", flag: "🇦🇬", dialCode: "+1", digits: 10),
        Country(name: "Armenia", flag: "🇦🇲", dialCode: "+374", digits: 8),
        Country(name: "Aruba", flag: "🇦🇼", dialCode: "+297", digits: 7),
        Country(name: "Azerbaijan", flag: "🇦🇿", dialCode: "+994", digits: 9),
        Country(name: "Bahamas", flag: "🇧🇸", dialCode: "+1", digits: 10),
        Country(name: "Bahrain", flag: "🇧🇭", dialCode: "+973", digits: 8),
        Country(name: "Bangladesh", flag: "🇧🇩", dialCode: "+880", digits: 10),
        Country(name: "Barbados", flag: "🇧🇧", dialCode: "+1", digits: 10),
        Country(name: "Belarus", flag: "🇧🇾", dialCode: "+375", digits: 9),
        Country(name: "Belize", flag: "🇧🇿", dialCode: "+501", digits: 7),
        Country(name: "Benin", flag: "🇧🇯", dialCode: "+229", digits: 8),
        Country(name: "Bhutan", flag: "🇧🇹", dialCode: "+975", digits: 8),
        Country(name: "Bolivia", flag: "🇧🇴", dialCode: "+591", digits: 8),
        Country(name: "Bosnia and Herzegovina", flag: "🇧🇦", dialCode: "+387", digits: 8),
        Country(name: "Botswana", flag: "🇧🇼", dialCode: "+267", digits: 8),
        Country(name: "Brunei", flag: "🇧🇳", dialCode: "+673", digits: 7),
        Country(name: "Bulgaria", flag: "🇧🇬", dialCode: "+359", digits: 9),
        Country(name: "Burkina Faso", flag: "🇧🇫", dialCode: "+226", digits: 8),
        Country(name: "Burundi", flag: "🇧🇮", dialCode: "+257", digits: 8),
        Country(name: "Cambodia", flag: "🇰🇭", dialCode: "+855", digits: 9),
        Country(name: "Cameroon", flag: "🇨🇲", dialCode: "+237", digits: 9),
        Country(name: "Cape Verde", flag: "🇨🇻", dialCode: "+238", digits: 7),
        Country(name: "Cayman Islands", flag: "🇰🇾", dialCode: "+1", digits: 10),
        Country(name: "Central African Republic", flag: "🇨🇫", dialCode: "+236", digits: 8),
        Country(name: "Chad", flag: "🇹🇩", dialCode: "+235", digits: 8),
        Country(name: "Chile", flag: "🇨🇱", dialCode: "+56", digits: 9),
        Country(name: "China", flag: "🇨🇳", dialCode: "+86", digits: 11),
        Country(name: "Comoros", flag: "🇰🇲", dialCode: "+269", digits: 7),
        Country(name: "Congo - Brazzaville", flag: "🇨🇬", dialCode: "+242", digits: 9),
        Country(name: "Congo - Kinshasa", flag: "🇨🇩", dialCode: "+243", digits: 9),
        Country(name: "Costa Rica", flag: "🇨🇷", dialCode: "+506", digits: 8),
        Country(name: "Côte d’Ivoire", flag: "🇨🇮", dialCode: "+225", digits: 10),
        Country(name: "Croatia", flag: "🇭🇷", dialCode: "+385", digits: 9),
        Country(name: "Cuba", flag: "🇨🇺", dialCode: "+53", digits: 8),
        Country(name: "Cyprus", flag: "🇨🇾", dialCode: "+357", digits: 8),
        Country(name: "Djibouti", flag: "🇩🇯", dialCode: "+253", digits: 8),
        Country(name: "Dominica", flag: "🇩🇲", dialCode: "+1", digits: 10),
        Country(name: "Dominican Republic", flag: "🇩🇴", dialCode: "+1", digits: 10),
        Country(name: "Ecuador", flag: "🇪🇨", dialCode: "+593", digits: 9),
        Country(name: "Egypt", flag: "🇪🇬", dialCode: "+20", digits: 10),
        Country(name: "El Salvador", flag: "🇸🇻", dialCode: "+503", digits: 8),
        Country(name: "Equatorial Guinea", flag: "🇬🇶", dialCode: "+240", digits: 9),
        Country(name: "Eritrea", flag: "🇪🇷", dialCode: "+291", digits: 7),
        Country(name: "Estonia", flag: "🇪🇪", dialCode: "+372", digits: 8),
        Country(name: "Eswatini", flag: "🇸🇿", dialCode: "+268", digits: 8),
        Country(name: "Ethiopia", flag: "🇪🇹", dialCode: "+251", digits: 9),
        Country(name: "Fiji", flag: "🇫🇯", dialCode: "+679", digits: 7),
        Country(name: "Gabon", flag: "🇬🇦", dialCode: "+241", digits: 8),
        Country(name: "Gambia", flag: "🇬🇲", dialCode: "+220", digits: 7),
        Country(name: "Georgia", flag: "🇬🇪", dialCode: "+995", digits: 9),
        Country(name: "Ghana", flag: "🇬🇭", dialCode: "+233", digits: 9),
        Country(name: "Gibraltar", flag: "🇬🇮", dialCode: "+350", digits: 8),
        Country(name: "Grenada", flag: "🇬🇩", dialCode: "+1", digits: 10),
        Country(name: "Guatemala", flag: "🇬🇹", dialCode: "+502", digits: 8),
        Country(name: "Guinea", flag: "🇬🇳", dialCode: "+224", digits: 9),
        Country(name: "Guinea-Bissau", flag: "🇬🇼", dialCode: "+245", digits: 9),
        Country(name: "Guyana", flag: "🇬🇾", dialCode: "+592", digits: 7),
        Country(name: "Haiti", flag: "🇭🇹", dialCode: "+509", digits: 8),
        Country(name: "Honduras", flag: "🇭🇳", dialCode: "+504", digits: 8),
        Country(name: "Hong Kong", flag: "🇭🇰", dialCode: "+852", digits: 8),
        Country(name: "Hungary", flag: "🇭🇺", dialCode: "+36", digits: 9),
        Country(name: "Iceland", flag: "🇮🇸", dialCode: "+354", digits: 9),
        Country(name: "India", flag: "🇮🇳", dialCode: "+91", digits: 10),
        Country(name: "Indonesia", flag: "🇮🇩", dialCode: "+62", digits: 11),
        Country(name: "Iran", flag: "🇮🇷", dialCode: "+98", digits: 10),
        Country(name: "Iraq", flag: "🇮🇶", dialCode: "+964", digits: 10),
        Country(name: "Israel", flag: "🇮🇱", dialCode: "+972", digits: 9),
        Country(name: "Jamaica", flag: "🇯🇲", dialCode: "+1", digits: 10),
        Country(name: "Japan", flag: "🇯🇵", dialCode: "+81", digits: 10),
        Country(name: "Jordan", flag: "🇯🇴", dialCode: "+962", digits: 9),
        Country(name: "Kazakhstan", flag: "🇰🇿", dialCode: "+7", digits: 10),
        Country(name: "Kenya", flag: "🇰🇪", dialCode: "+254", digits: 9),
        Country(name: "Kiribati", flag: "🇰🇮", dialCode: "+686", digits: 8),
        Country(name: "Kuwait", flag: "🇰🇼", dialCode: "+965", digits: 8),
        Country(name: "Kyrgyzstan", flag: "🇰🇬", dialCode: "+996", digits: 9),
        Country(name: "Laos", flag: "🇱🇦", dialCode: "+856", digits: 10),
        Country(name: "Latvia", flag: "🇱🇻", dialCode: "+371", digits: 8),
        Country(name: "Lebanon", flag: "🇱🇧", dialCode: "+961", digits: 8),
        Country(name: "Lesotho", flag: "🇱🇸", dialCode: "+266", digits: 8),
        Country(name: "Liberia", flag: "🇱🇷", dialCode: "+231", digits: 9),
        Country(name: "Libya", flag: "🇱🇾", dialCode: "+218", digits: 10),
        Country(name: "Liechtenstein", flag: "🇱🇮", dialCode: "+423", digits: 9),
        Country(name: "Lithuania", flag: "🇱🇹", dialCode: "+370", digits: 8),
        Country(name: "Luxembourg", flag: "🇱🇺", dialCode: "+352", digits: 11),
        Country(name: "Macau", flag: "🇲🇴", dialCode: "+853", digits: 8),
        Country(name: "Madagascar", flag: "🇲🇬", dialCode: "+261", digits: 9),
        Country(name: "Malawi", flag: "🇲🇼", dialCode: "+265", digits: 9),
        Country(name: "Malaysia", flag: "🇲🇾", dialCode: "+60", digits: 10),
        Country(name: "Maldives", flag: "🇲🇻", dialCode: "+960", digits: 7),
        Country(name: "Mali", flag: "🇲🇱", dialCode: "+223", digits: 8),
        Country(name: "Malta", flag: "🇲🇹", dialCode: "+356", digits: 8),
        Country(name: "Marshall Islands", flag: "🇲🇭", dialCode: "+692", digits: 7),
        Country(name: "Mauritania", flag: "🇲🇷", dialCode: "+222", digits: 8),
        Country(name: "Mauritius", flag: "🇲🇺", dialCode: "+230", digits: 8),
        Country(name: "Micronesia", flag: "🇫🇲", dialCode: "+691", digits: 7),
        Country(name: "Moldova", flag: "🇲🇩", dialCode: "+373", digits: 8),
        Country(name: "Monaco", flag: "🇲🇨", dialCode: "+377", digits: 9),
        Country(name: "Mongolia", flag: "🇲🇳", dialCode: "+976", digits: 8),
        Country(name: "Montenegro", flag: "🇲🇪", dialCode: "+382", digits: 9),
        Country(name: "Mozambique", flag: "🇲🇿", dialCode: "+258", digits: 9),
        Country(name: "Myanmar", flag: "🇲🇲", dialCode: "+95", digits: 10),
        Country(name: "Namibia", flag: "🇳🇦", dialCode: "+264", digits: 10),
        Country(name: "Nauru", flag: "🇳🇷", dialCode: "+674", digits: 7),
        Country(name: "Nepal", flag: "🇳🇵", dialCode: "+977", digits: 10),
        Country(name: "New Zealand", flag: "🇳🇿", dialCode: "+64", digits: 10),
        Country(name: "Nicaragua", flag: "🇳🇮", dialCode: "+505", digits: 8),
        Country(name: "Niger", flag: "🇳🇪", dialCode: "+227", digits: 8),
        Country(name: "Nigeria", flag: "🇳🇬", dialCode: "+234", digits: 10),
        Country(name: "North Korea", flag: "🇰🇵", dialCode: "+850", digits: 10),
        Country(name: "North Macedonia", flag: "🇲🇰", dialCode: "+389", digits: 8),
        Country(name: "Oman", flag: "🇴🇲", dialCode: "+968", digits: 8),
        Country(name: "Pakistan", flag: "🇵🇰", dialCode: "+92", digits: 10),
        Country(name: "Palau", flag: "🇵🇼", dialCode: "+680", digits: 7),
        Country(name: "Palestine", flag: "🇵🇸", dialCode: "+970", digits: 9),
        Country(name: "Panama", flag: "🇵🇦", dialCode: "+507", digits: 8),
        Country(name: "Papua New Guinea", flag: "🇵🇬", dialCode: "+675", digits: 8),
        Country(name: "Paraguay", flag: "🇵🇾", dialCode: "+595", digits: 9),
        Country(name: "Peru", flag: "🇵🇪", dialCode: "+51", digits: 9),
        Country(name: "Philippines", flag: "🇵🇭", dialCode: "+63", digits: 10),
        Country(name: "Qatar", flag: "🇶🇦", dialCode: "+974", digits: 8),
        Country(name: "Russia", flag: "🇷🇺", dialCode: "+7", digits: 10),
        Country(name: "Rwanda", flag: "🇷🇼", dialCode: "+250", digits: 9),
        Country(name: "Saint Kitts and Nevis", flag: "🇰🇳", dialCode: "+1", digits: 10),
        Country(name: "Saint Lucia", flag: "🇱🇨", dialCode: "+1", digits: 10),
        Country(name: "Saint Vincent and the Grenadines", flag: "🇻🇨", dialCode: "+1", digits: 10),
        Country(name: "Samoa", flag: "🇼🇸", dialCode: "+685", digits: 7),
        Country(name: "San Marino", flag: "🇸🇲", dialCode: "+378", digits: 10),
        Country(name: "São Tomé and Príncipe", flag: "🇸🇹", dialCode: "+239", digits: 7),
        Country(name: "Saudi Arabia", flag: "🇸🇦", dialCode: "+966", digits: 9),
        Country(name: "Senegal", flag: "🇸🇳", dialCode: "+221", digits: 9),
        Country(name: "Serbia", flag: "🇷🇸", dialCode: "+381", digits: 9),
        Country(name: "Seychelles", flag: "🇸🇨", dialCode: "+248", digits: 7),
        Country(name: "Sierra Leone", flag: "🇸🇱", dialCode: "+232", digits: 8),
        Country(name: "Singapore", flag: "🇸🇬", dialCode: "+65", digits: 8),
        Country(name: "Slovakia", flag: "🇸🇰", dialCode: "+421", digits: 9),
        Country(name: "Slovenia", flag: "🇸🇮", dialCode: "+386", digits: 8),
        Country(name: "Solomon Islands", flag: "🇸🇧", dialCode: "+677", digits: 7),
        Country(name: "Somalia", flag: "🇸🇴", dialCode: "+252", digits: 8),
        Country(name: "South Africa", flag: "🇿🇦", dialCode: "+27", digits: 9),
        Country(name: "South Korea", flag: "🇰🇷", dialCode: "+82", digits: 10),
        Country(name: "South Sudan", flag: "🇸🇸", dialCode: "+211", digits: 9),
        Country(name: "Sri Lanka", flag: "🇱🇰", dialCode: "+94", digits: 9),
        Country(name: "Sudan", flag: "🇸🇩", dialCode: "+249", digits: 9),
        Country(name: "Suriname", flag: "🇸🇷", dialCode: "+597", digits: 7),
        Country(name: "Syria", flag: "🇸🇾", dialCode: "+963", digits: 9),
        Country(name: "Taiwan", flag: "🇹🇼", dialCode: "+886", digits: 9),
        Country(name: "Tajikistan", flag: "🇹🇯", dialCode: "+992", digits: 9),
        Country(name: "Tanzania", flag: "🇹🇿", dialCode: "+255", digits: 9),
        Country(name: "Thailand", flag: "🇹🇭", dialCode: "+66", digits: 9),
        Country(name: "Timor-Leste", flag: "🇹🇱", dialCode: "+670", digits: 8),
        Country(name: "Togo", flag: "🇹🇬", dialCode: "+228", digits: 8),
        Country(name: "Tonga", flag: "🇹🇴", dialCode: "+676", digits: 7),
        Country(name: "Trinidad and Tobago", flag: "🇹🇹", dialCode: "+1", digits: 10),
        Country(name: "Tunisia", flag: "🇹🇳", dialCode: "+216", digits: 8),
        Country(name: "Turkey", flag: "🇹🇷", dialCode: "+90", digits: 10),
        Country(name: "Turkmenistan", flag: "🇹🇲", dialCode: "+993", digits: 8),
        Country(name: "Tuvalu", flag: "🇹🇻", dialCode: "+688", digits: 6),
        Country(name: "Uganda", flag: "🇺🇬", dialCode: "+256", digits: 9),
        Country(name: "Ukraine", flag: "🇺🇦", dialCode: "+380", digits: 9),
        Country(name: "Uruguay", flag: "🇺🇾", dialCode: "+598", digits: 8),
        Country(name: "Uzbekistan", flag: "🇺🇿", dialCode: "+998", digits: 9),
        Country(name: "Vanuatu", flag: "🇻🇺", dialCode: "+678", digits: 7),
        Country(name: "Vatican City", flag: "🇻🇦", dialCode: "+379", digits: 10),
        Country(name: "Venezuela", flag: "🇻🇪", dialCode: "+58", digits: 10),
        Country(name: "Vietnam", flag: "🇻🇳", dialCode: "+84", digits: 10),
        Country(name: "Yemen", flag: "🇾🇪", dialCode: "+967", digits: 9),
        Country(name: "Zambia", flag: "🇿🇲", dialCode: "+260", digits: 9),
        Country(name: "Zimbabwe", flag: "🇿🇼", dialCode: "+263", digits: 9),
    ]

    /// Dial codes longest-first, so "+351" wins over "+3" when matching a prefix.
    static let byDialLengthDesc: [Country] = all.sorted { $0.dialCode.count > $1.dialCode.count }
}

/// Scrollable + searchable country picker. Presented as a sheet from the phone
/// field's dial-code button. Filters on country name and dial code.
struct CountryPickerSheet: View {
    let onPick: (Country) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [Country] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return Country.all }
        let digits = q.filter(\.isNumber)
        return Country.all.filter {
            $0.name.lowercased().contains(q)
                || $0.dialCode.contains(q)
                || (!digits.isEmpty && $0.dialCode.contains(digits))
        }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { _ in
                List(filtered) { country in
                    Button {
                        onPick(country)
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            Text(country.flag).font(.system(size: 22))
                            Text(country.name)
                                .font(.cfSans(16))
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            Text(country.dialCode)
                                .font(.cfSans(15))
                                .foregroundStyle(Theme.stone)
                        }
                        .contentShape(.rect)
                    }
                    .listRowBackground(Theme.surface)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(Theme.cream)
            }
            .navigationTitle("Country")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.wine)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search country or code")
        }
    }
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
    @State private var showPicker = false

    var body: some View {
        HStack(spacing: trailing ? 6 : 10) {
            Button {
                showPicker = true
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
            .buttonStyle(.plain)

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
        .sheet(isPresented: $showPicker) {
            CountryPickerSheet { country in
                dialCode = country.dialCode
                national = String(national.prefix(country.digits))  // re-cap for the new country
                recombine()
            }
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
        .onChange(of: phone) {
            // External writes land AFTER onAppear — Settings populates the
            // binding from an async profile fetch, so the one-shot parse saw
            // an empty string and the saved number never displayed (looked
            // like phone numbers "don't save"). Re-split whenever the bound
            // value isn't our own recombine() echo.
            let combined = national.isEmpty ? "" : "\(dialCode) \(national)"
            guard phone != combined else { return }
            if phone.trimmingCharacters(in: .whitespaces).isEmpty {
                national = ""
            } else {
                parse()
                if !national.isEmpty { recombine() }
            }
        }
    }

    private var selectedFlag: String {
        Country.all.first { $0.dialCode == dialCode }?.flag ?? "🏳️"
    }

    private var maxDigits: Int {
        Country.all.first { $0.dialCode == dialCode }?.digits ?? 15
    }

    /// A grey example with up to 12 digits, grouped in threes (a trailing single
    /// digit is merged into the previous group).
    private var placeholder: String {
        let sample = Array("612345678901234".prefix(min(maxDigits, 12)))
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
