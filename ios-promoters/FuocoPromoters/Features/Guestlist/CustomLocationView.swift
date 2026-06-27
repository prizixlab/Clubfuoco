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

                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 12)).foregroundStyle(Theme.flame)
                    Text("Drag the map so the pin sits exactly on the entrance — guests check in here.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.flame.opacity(0.08)))

                EmberPillButton(title: "Use this location") {
                    model.customCoord = centerCoord
                    model.customConfirmed = true
                }
                .padding(.top, 4)
                .disabled(model.customName.trimmingCharacters(in: .whitespaces).isEmpty)
                .opacity(model.customName.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)

                if model.customName.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text("Add a location name to continue.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                        .frame(maxWidth: .infinity)
                }

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
    }

    private func geocode() {
        let q = model.customAddress.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        focused = nil; geocoding = true
        CLGeocoder().geocodeAddressString(q) { marks, _ in
            geocoding = false
            guard let c = marks?.first?.location?.coordinate else { return }
            centerCoord = c
            withAnimation {
                camera = .region(MKCoordinateRegion(center: c,
                    span: MKCoordinateSpan(latitudeDelta: 0.008, longitudeDelta: 0.008)))
            }
        }
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
