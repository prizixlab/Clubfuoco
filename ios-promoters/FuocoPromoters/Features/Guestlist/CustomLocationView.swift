import SwiftUI
import MapKit
import CoreLocation

/// Custom-location picker: a map with a fixed centre pin (drag the map so the
/// pin lands on the entrance), plus name + address fields. Captures the map's
/// centre coordinate as the venue pin.
struct CustomLocationView: View {
    @ObservedObject var model: CreateGuestlistModel
    @FocusState private var focused: Field?
    enum Field { case name, address }

    // Default to central Barcelona.
    @State private var camera: MapCameraPosition = .region(
        MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 41.3874, longitude: 2.1686),
                           span: MKCoordinateSpan(latitudeDelta: 0.04, longitudeDelta: 0.04)))
    @State private var centerCoord = CLLocationCoordinate2D(latitude: 41.3874, longitude: 2.1686)
    @State private var geocoding = false
    @State private var candidates: [CLPlacemark] = []
    @State private var showCandidates = false
    @State private var geoError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                field("Location name") {
                    TextField("", text: $model.customName,
                              prompt: Text("e.g. Villa Aurora, Rooftop 22")
                                .foregroundStyle(Theme.parchmentDim))
                        .font(.cfSans(16)).foregroundStyle(Theme.parchment)
                        .focused($focused, equals: .name)
                        .textInputAutocapitalization(.words)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Kicker("Address")
                    HStack(spacing: 10) {
                        TextField("", text: $model.customAddress,
                                  prompt: Text("Street, number, city")
                                    .foregroundStyle(Theme.parchmentDim))
                            .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                            .focused($focused, equals: .address)
                            .submitLabel(.search)
                            .onSubmit { geocode() }
                        Button {
                            Haptics.tap(); geocode()
                        } label: {
                            if geocoding {
                                ProgressView().tint(Theme.emberCream).frame(width: 20, height: 20)
                            } else {
                                Image(systemName: "location.magnifyingglass")
                                    .foregroundStyle(Theme.emberCream)
                            }
                        }
                        .frame(width: 38, height: 38)
                        .background(Circle().fill(Theme.ember))
                    }
                    .padding(.vertical, 8)
                    .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }
                }

                // Map with fixed centre pin
                ZStack {
                    Map(position: $camera)
                        .frame(height: 280)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusCard))
                        .onMapCameraChange(frequency: .continuous) { ctx in
                            centerCoord = ctx.region.center
                        }
                    // Fixed centre pin (sits slightly above true centre so the
                    // tip points at the centre coordinate).
                    Image(systemName: "mappin")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(Theme.ember)
                        .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                        .offset(y: -17)
                        .allowsHitTesting(false)
                }
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))

                if let geoError {
                    Text(geoError).font(.cfSans(12)).foregroundStyle(Theme.wine)
                }

                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 12)).foregroundStyle(Theme.flame)
                    Text("Drag the map so the pin sits exactly on the entrance — guests check in here.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.flame.opacity(0.08)))

                EmberPillButton(title: "Use this location") {
                    confirmLocation()
                }
                .padding(.top, 4)

                Spacer(minLength: 40)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Button("Done") { focused = nil }.foregroundStyle(Theme.ember)
                Spacer()
            }
        }
        .sheet(isPresented: $showCandidates) {
            candidatePicker
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.night)
        }
    }

    private var candidatePicker: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Which one?")
                .font(.cfSerif(28)).foregroundStyle(Theme.parchment)
                .padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 4)
            Text("We found a few matches near Barcelona — pick the right one.")
                .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                .padding(.horizontal, 24).padding(.bottom, 12)
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(candidates.enumerated()), id: \.offset) { _, m in
                        Button {
                            Haptics.tap(); apply(m); showCandidates = false
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "mappin.circle.fill")
                                    .foregroundStyle(Theme.ember).font(.system(size: 20))
                                Text(describe(m))
                                    .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                                    .multilineTextAlignment(.leading)
                                Spacer()
                            }
                            .padding(.vertical, 16).padding(.horizontal, 24)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Divider().background(Theme.hairline).padding(.horizontal, 24)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // All custom pins are assumed within 20 miles of Barcelona.
    private static let barcelona = CLLocation(latitude: 41.3874, longitude: 2.1686)
    private static let radiusMeters: CLLocationDistance = 32_187 // 20 miles

    private func geocode() {
        let raw = model.customAddress.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return }
        // Spain uses 5-digit postcodes (Barcelona starts 08…). Without one,
        // a street name is ambiguous, so we always ask the promoter to confirm.
        let hasPostcode = raw.range(of: #"\b\d{5}\b"#, options: .regularExpression) != nil
        var q = raw
        if !q.lowercased().contains("barcelona") { q += ", Barcelona, Spain" }
        focused = nil; geocoding = true; geoError = nil
        let region = CLCircularRegion(center: Self.barcelona.coordinate,
                                      radius: Self.radiusMeters, identifier: "bcn")
        CLGeocoder().geocodeAddressString(q, in: region) { marks, _ in
            geocoding = false
            // Keep only results within 20 miles of Barcelona, nearest first.
            let near = (marks ?? [])
                .filter { ($0.location?.distance(from: Self.barcelona) ?? .greatestFiniteMagnitude) <= Self.radiusMeters }
                .sorted { ($0.location?.distance(from: Self.barcelona) ?? 0) < ($1.location?.distance(from: Self.barcelona) ?? 0) }
            if near.isEmpty {
                geoError = "Couldn't find that address near Barcelona. Drop the pin manually."
            } else if near.count == 1 && hasPostcode {
                apply(near[0])                          // precise → trust it
            } else {
                candidates = near; showCandidates = true // ambiguous → confirm
            }
        }
    }

    /// Confirm the dropped pin. If no name was typed, reverse-geocode the pin
    /// to label it (and fill the address if blank), so a manual drag still
    /// produces a readable location.
    private func confirmLocation() {
        model.customCoord = centerCoord
        if model.customName.trimmingCharacters(in: .whitespaces).isEmpty {
            CLGeocoder().reverseGeocodeLocation(
                CLLocation(latitude: centerCoord.latitude, longitude: centerCoord.longitude)
            ) { marks, _ in
                if let m = marks?.first {
                    model.customName = [m.name, m.thoroughfare].compactMap { $0 }.first ?? "Custom location"
                    if model.customAddress.trimmingCharacters(in: .whitespaces).isEmpty {
                        model.customAddress = describe(m)
                    }
                } else {
                    model.customName = "Custom location"
                }
            }
        }
        model.customConfirmed = true
    }

    private func apply(_ mark: CLPlacemark) {
        guard let c = mark.location?.coordinate else { return }
        centerCoord = c
        withAnimation {
            camera = .region(MKCoordinateRegion(center: c,
                span: MKCoordinateSpan(latitudeDelta: 0.008, longitudeDelta: 0.008)))
        }
    }

    /// One-line readable address for a candidate.
    private func describe(_ m: CLPlacemark) -> String {
        [ [m.subThoroughfare, m.thoroughfare].compactMap { $0 }.joined(separator: " "),
          m.locality, m.postalCode ]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: ", ")
            .ifEmpty(m.name ?? "Unknown location")
    }

    @ViewBuilder
    private func field<C: View>(_ label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label)
            content()
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }
        }
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}
