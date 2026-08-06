import SwiftUI

/// The live door screen: camera scanner, sync status bar, and the result sheet.
/// Auto-returns to the camera after each verdict so the queue keeps moving (§2).
struct ScanView: View {
    let session: DeviceSession
    @ObservedObject private var store: DoorStore
    @StateObject private var sync: SyncManager
    @StateObject private var controller: ScanController
    private let repo: DoorRepo

    @ObservedObject private var pack: NightPackStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var showRecent = false
    @State private var showPack = false
    @State private var showVenue = false
    @State private var showManualEntry = false
    @State private var manualCode = ""

    var onVenueChange: (() -> Void)? = nil

    init(session: DeviceSession, repo: DoorRepo, store: DoorStore, pack: NightPackStore,
         onVenueChange: (() -> Void)? = nil) {
        self.onVenueChange = onVenueChange
        self.session = session
        self.repo = repo
        _store = ObservedObject(wrappedValue: store)
        _pack = ObservedObject(wrappedValue: pack)
        _controller = StateObject(wrappedValue: ScanController(store: store, repo: repo, pack: pack))
        _sync = StateObject(wrappedValue: SyncManager(repo: repo, store: store, session: session))
    }

    private var today: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                // Open-access mode resolves live per scan — no manifest, no 12h
                // lock, so the sync bar would be meaningless. Hidden there.
                if !AppMode.openAccess {
                    SyncStatusBar(sync: sync, pendingCount: store.unsynced.count) {
                        Task { await sync.fullSync(date: today) }
                    }
                }
                cameraArea
            }

            if let toast = controller.toast { toastView(toast) }
        }
        .task {
            // Open access has no venue → no manifest to pull; scanning is live.
            if !AppMode.openAccess && store.manifest == nil { await sync.goOnShift(date: today) }
        }
        .sheet(item: $controller.current) { desc in
            AccessResultView(descriptor: desc,
                             liveUsed: store.admittedCount(desc.tokenRef),
                             controller: controller) {
                controller.current = nil
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Coming back to the foreground is the other moment signal is
            // commonly restored (phone unlocked indoors, app resumed).
            if phase == .active { Task { await sync.flushQueue() } }
        }
        .sheet(isPresented: $showVenue) {
            VenuePickerView(repo: repo, current: session) { _ in
                // The pack belongs to the old venue — drop it so a stale cache
                // can never admit at the new door.
                pack.clear()
                onVenueChange?()
            }
        }
        .sheet(isPresented: $showPack) {
            NightPackView(pack: pack, repo: repo, session: session)
        }
        .sheet(isPresented: $showRecent) {
            RecentScansView(store: store, controller: controller)
        }
        .preferredColorScheme(.dark)
    }

    // MARK: Header
    private var header: some View {
        HStack {
            // Tap the venue to switch doors — staff working more than one club
            // shouldn't have to reinstall.
            Button { showVenue = true } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Kicker("Fuoco Door")
                    HStack(spacing: 6) {
                        Text(session.venueName).font(.cfSerif(24)).foregroundStyle(Theme.parchment)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.parchmentDim)
                    }
                }
            }
            Spacer()
            // Offline pack: filled padlock once a night is cached, so staff can
            // tell at a glance whether the door survives losing signal.
            Button { showPack = true } label: {
                Image(systemName: pack.manifest == nil ? "lock.open" : "lock.doc.fill")
                    .font(.system(size: 19))
                    .foregroundStyle(pack.manifest == nil ? Theme.parchmentDim : Theme.admitBright)
            }
            Button { showRecent = true } label: {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 20)).foregroundStyle(Theme.flame)
            }
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
    }

    // MARK: Camera / lock / fallback
    @ViewBuilder private var cameraArea: some View {
        if sync.isLocked {
            lockedScreen
        } else if QRScannerView.isSupported {
            ZStack {
                QRScannerView(onScan: handleScan, isActive: controller.current == nil && !showRecent)
                    .ignoresSafeArea(edges: .bottom)
                reticle
                VStack {
                    Spacer()
                    manualEntryButton.padding(.bottom, 28)
                }
            }
        } else {
            // Simulator / no camera → manual entry keeps the loop testable.
            noCameraFallback
        }
    }

    private var reticle: some View {
        RoundedRectangle(cornerRadius: 24)
            .stroke(Theme.emberCream.opacity(0.85), lineWidth: 3)
            .frame(width: 240, height: 240)
            .shadow(color: .black.opacity(0.4), radius: 8)
    }

    private var lockedScreen: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "lock.fill").font(.system(size: 44)).foregroundStyle(Theme.deny)
            Text("Scanning locked").font(.cfSerif(28)).foregroundStyle(Theme.parchment)
            Text(String(format: "Connect to the internet to keep scanning — last sync %.0fh ago.",
                        sync.hoursSinceSync ?? 12))
                .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                .multilineTextAlignment(.center).padding(.horizontal, 40)
            Text("\(store.unsynced.count) scans safely queued").font(.cfMono(12)).foregroundStyle(Theme.flame)
            EmberPillButton(title: "Sync now", loading: sync.isSyncing) {
                Task { await sync.fullSync(date: today) }
            }
            .padding(.horizontal, 60).padding(.top, 8)
            if let e = sync.lastError {
                Text(e).font(.cfMono(11)).foregroundStyle(Theme.deny).multilineTextAlignment(.center).padding(.horizontal, 40)
            }
            Spacer()
        }
    }

    private var manualEntryButton: some View {
        Button { showManualEntry = true } label: {
            Label("Enter code manually", systemImage: "keyboard")
                .font(.cfSans(13, weight: .medium)).foregroundStyle(Theme.parchment)
                .padding(.horizontal, 18).padding(.vertical, 12)
                .background(Capsule().fill(Theme.night.opacity(0.7)))
        }
        .alert("Enter QR code", isPresented: $showManualEntry) {
            TextField("e.g. PAID-ADA-4", text: $manualCode)
            Button("Scan") { if !manualCode.isEmpty { handleScan(manualCode); manualCode = "" } }
            Button("Cancel", role: .cancel) { manualCode = "" }
        }
    }

    private var noCameraFallback: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "camera.metering.unknown").font(.system(size: 40)).foregroundStyle(Theme.parchmentFaint)
            Text("Camera unavailable").font(.cfSerif(24)).foregroundStyle(Theme.parchment)
            Text("Run on a real device to scan. Meanwhile, enter a code to test the loop.")
                .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                .multilineTextAlignment(.center).padding(.horizontal, 40)
            manualEntryButton
            Spacer()
        }
    }

    // MARK: Scan handling
    private func handleScan(_ payload: String) {
        guard !sync.isLocked else { return }
        guard controller.current == nil, !controller.isResolving else { return }
        guard controller.shouldPresent(payload: payload) else { return }
        Task { await controller.present(payload: payload) }
    }

    private func toastView(_ text: String) -> some View {
        VStack {
            Spacer()
            Text(text)
                .font(.cfSans(14, weight: .semibold)).foregroundStyle(Theme.emberCream)
                .padding(.horizontal, 20).padding(.vertical, 12)
                .background(Capsule().fill(Theme.ember))
                .padding(.bottom, 40)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .task {
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            withAnimation { controller.toast = nil }
        }
    }
}
