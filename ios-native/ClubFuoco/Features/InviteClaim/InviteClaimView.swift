import SwiftUI

/// Native screen the Fuoco app shows when a Universal Link to
/// /i/<token> opens it. Mirrors the web claim page but auto-fills the
/// recipient's name from their Fuoco profile.
struct InviteClaimView: View {
    let token: String
    /// When set (e.g. opened from the "My Invites" row in Bookings), the
    /// view skips the claim form and goes straight to the ticket — the user
    /// has already claimed this invite.
    var preclaimedGuestId: String? = nil
    var preclaimedName: String? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @Environment(\.api) private var api
    @State private var loading = true
    @State private var error: String?
    @State private var detail: InviteDetail?
    @State private var name: String = ""
    /// One entry per extra spot the claimer is bringing. Each is either an
    /// open spot (anonymous plus-one, filled via the shared link) or a
    /// specific friend who gets a targeted invite to claim their own row.
    @State private var slots: [InviteSlot] = []
    @State private var pickingSlotId: UUID?
    @State private var submitting = false
    @State private var claimedGuestId: String?
    // Reduced signup, run AFTER the claim — see saveSpotCard.
    @State private var attaching = false
    @State private var attached = false
    @State private var attachError: String?
    @State private var guests: [InviteGuest] = []
    // Post-claim party management (on the ticket).
    @State private var partyPlusOnes = 0
    @State private var invitedList: [InvitedFriend] = []
    @State private var partyLoaded = false
    @State private var partyBusy = false
    @State private var showTicketFriendPicker = false

    struct InvitedFriend: Identifiable, Hashable { let id: UUID; let name: String }

    private static let baseURL = "https://clubfuoco.com"
    private var inviteURL: URL { URL(string: "\(Self.baseURL)/i/\(token)")! }

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            content
        }
        .preferredColorScheme(.dark)
        .task { await load() }
        .sheet(isPresented: Binding(get: { pickingSlotId != nil }, set: { if !$0 { pickingSlotId = nil } })) {
            FriendPickerSheet(excluded: assignedFriendIds) { friend in
                if let sid = pickingSlotId, let idx = slots.firstIndex(where: { $0.id == sid }) {
                    slots[idx] = .friend(friend)
                }
                pickingSlotId = nil
            }
            .presentationDetents([.large])
        }
    }

    private var assignedFriendIds: Set<UUID> {
        Set(slots.compactMap { if case .friend(let f) = $0 { return f.id } else { return nil } })
    }

    private var openSpots: Int {
        slots.filter { if case .open = $0 { return true } else { return false } }.count
    }

    @ViewBuilder
    private func slotRow(_ slot: InviteSlot) -> some View {
        HStack(spacing: 12) {
            switch slot {
            case .open(let id):
                Image(systemName: "person.badge.plus")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.parchment.opacity(0.5))
                    .frame(width: 38, height: 38)
                    .background(Circle().stroke(Theme.parchment.opacity(0.15)))
                Button { Haptics.tap(); pickingSlotId = id } label: {
                    Text("Invite a friend").font(.cfSans(15)).foregroundStyle(Theme.ember)
                }
                Spacer()
                Text("OPEN").font(.cfMono(8)).kerning(1).foregroundStyle(Theme.parchment.opacity(0.35))
                removeSlotButton(id)
            case .friend(let f):
                Circle().fill(Theme.parchment.opacity(0.12)).frame(width: 38, height: 38)
                    .overlay(Text(f.initials).font(.cfSerif(15)).foregroundStyle(Theme.flame))
                Text(f.fullName ?? "Friend").font(.cfSans(15)).foregroundStyle(Theme.parchment)
                Spacer()
                removeSlotButton(f.id)
            }
        }
        .padding(.vertical, 4)
    }

    private func removeSlotButton(_ id: UUID) -> some View {
        Button {
            Haptics.tap()
            slots.removeAll { $0.id == id }
        } label: {
            Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.parchment.opacity(0.4))
                .frame(width: 28, height: 28)
        }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            ProgressView().tint(Theme.parchment)
        } else if let error {
            VStack(spacing: 12) {
                Text(error).font(.cfSans(15)).foregroundStyle(Theme.parchment)
                Button("Close") { dismiss() }
                    .foregroundStyle(Theme.ember)
            }
            .padding(40)
        } else if let claimedGuestId, let detail {
            ticket(guestId: claimedGuestId, detail: detail)
        } else if let detail {
            form(detail: detail)
        }
    }

    // ── Loading ──────────────────────────────────────────────────────────────

    private func load() async {
        loading = true
        defer { loading = false }
        struct Resp: Decodable, Sendable {
            let allocation: InviteDetail
            let guests: [InviteGuest]
        }
        do {
            let resp: Resp = try await api.get("/api/promoter-invites/\(token)")
            self.detail = resp.allocation
            self.guests = resp.guests
            // Re-opening an already-claimed invite — jump to ticket.
            if let id = preclaimedGuestId {
                claimedGuestId = id
                if let n = preclaimedName, !n.isEmpty { name = n }
            } else if let full = auth.profile?.fullName, !full.isEmpty {
                name = full
            }
        } catch {
            self.error = "Couldn't load this invite — the link may be expired."
        }
    }

    // ── Form ─────────────────────────────────────────────────────────────────

    private func form(detail: InviteDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header(detail: detail)

                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("RESERVE YOUR SPOT")
                            .font(.cfMono(10)).kerning(2)
                            .foregroundStyle(Theme.flame)
                        Spacer()
                    }

                    TextField("", text: $name,
                              prompt: Text("Full name").foregroundStyle(Theme.parchment.opacity(0.5)))
                        .font(.cfSans(16))
                        .foregroundStyle(Theme.parchment)
                        .textInputAutocapitalization(.words)
                        .padding(.vertical, 10)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(Theme.parchment.opacity(0.2)).frame(height: 1)
                        }

                    // One slot per extra spot. Assign a friend (targeted invite,
                    // they claim their own row) or leave it open (anonymous
                    // plus-one, filled by whoever uses the shared link).
                    Rectangle().fill(Theme.parchment.opacity(0.1)).frame(height: 1).padding(.vertical, 4)
                    let cap = detail.night.maxPlusOnes ?? 20
                    HStack {
                        Text("BRING PEOPLE")
                            .font(.cfMono(9)).kerning(1.5)
                            .foregroundStyle(Theme.parchment.opacity(0.5))
                        Spacer()
                        if !slots.isEmpty {
                            Text("\(slots.count)/\(cap)")
                                .font(.cfMono(9))
                                .foregroundStyle(Theme.parchment.opacity(0.4))
                        }
                    }

                    ForEach(slots) { slot in
                        slotRow(slot)
                    }

                    if slots.count < cap {
                        Button {
                            Haptics.tap(); slots.append(.open(UUID()))
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "plus.circle").font(.system(size: 16))
                                Text("Add a spot").font(.cfSans(14, weight: .medium))
                                Spacer()
                            }
                            .foregroundStyle(Theme.ember)
                            .padding(.vertical, 8)
                        }
                    }

                    if openSpots > 0 {
                        ShareLink(item: inviteURL,
                                  subject: Text(detail.night.title ?? detail.night.venueName),
                                  message: Text("Join me on the guestlist")) {
                            HStack(spacing: 8) {
                                Image(systemName: "square.and.arrow.up").font(.system(size: 13, weight: .semibold))
                                Text("Share link for open spots").font(.cfSans(13, weight: .semibold))
                                Spacer()
                            }
                            .foregroundStyle(Theme.parchment.opacity(0.8))
                            .padding(.vertical, 6)
                        }
                        .simultaneousGesture(TapGesture().onEnded { Haptics.tap() })
                    }
                }
                .padding(18)
                .background(RoundedRectangle(cornerRadius: 18).fill(Color(hex: 0x15110E)))

                Button(action: submit) {
                    Text(submitting ? "Joining…" : "Add me to the list")
                        .font(.cfSans(15, weight: .semibold))
                        .foregroundStyle(Color(hex: 0xFFF6E5))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(Theme.ember))
                }
                .disabled(submitting || name.trimmingCharacters(in: .whitespaces).isEmpty)

                if detail.groupVisible {
                    Text("EVERYONE WILL SEE YOU ON THE GUESTLIST")
                        .font(.cfMono(9)).kerning(1.5)
                        .foregroundStyle(Theme.parchment.opacity(0.5))
                        .frame(maxWidth: .infinity)
                }

                Button("Not now") { dismiss() }
                    .foregroundStyle(Theme.parchment.opacity(0.5))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
            }
            .padding(24)
        }
    }

    private func header(detail: InviteDetail) -> some View {
        let night = detail.night
        return VStack(alignment: .leading, spacing: 6) {
            Text("YOU'RE INVITED")
                .font(.cfMono(11)).kerning(2)
                .foregroundStyle(Theme.flame)
            Text(night.title ?? night.venueName)
                .font(.cfSerif(40))
                .foregroundStyle(Theme.parchment)
            Text("\(night.venueName) · \(Self.formatDate(night.nightDate))")
                .font(.cfSans(13))
                .foregroundStyle(Theme.parchment.opacity(0.7))
        }
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        submitting = true
        Task {
            defer { submitting = false }
            // claimed_by_user is derived server-side from the Bearer token —
            // we deliberately don't send it (the server ignores body-supplied
            // ids to prevent claim spoofing).
            struct Body: Encodable, Sendable {
                let fullName: String
                let plusOnes: Int
                enum CodingKeys: String, CodingKey {
                    case fullName = "full_name"
                    case plusOnes = "plus_ones"
                }
            }
            struct ClaimedGuest: Decodable, Sendable { let id: String }
            struct Resp: Decodable, Sendable { let guest: ClaimedGuest }
            do {
                // Open slots become anonymous plus-ones on my own row; friend
                // slots claim their own row via the targeted invite below.
                let resp: Resp = try await api.post(
                    "/api/promoter-invites/\(token)/claim",
                    body: Body(fullName: trimmed, plusOnes: openSpots))
                claimedGuestId = resp.guest.id
                Haptics.success()
                // Tell the Tickets tab to refresh its Guestlists section now.
                NotificationCenter.default.post(name: .cfInviteClaimed, object: nil)

                // Fire targeted invites for the friends assigned to slots, and
                // remember them locally so the ticket can show their status.
                let friends = slots.compactMap { slot -> FriendUser? in
                    if case .friend(let f) = slot { return f }
                    return nil
                }
                if !friends.isEmpty {
                    InvitedFriendsStore.save(friends, token: token)
                    struct InviteBody: Encodable { let userIds: [String]
                        enum CodingKeys: String, CodingKey { case userIds = "user_ids" } }
                    struct InviteResult: Decodable, Sendable { let sent: Int }
                    let _: InviteResult? = try? await api.post(
                        "/api/promoter-invites/\(token)/invite-friends",
                        body: InviteBody(userIds: friends.map { $0.id.uuidString.lowercased() }))
                }
                // Refresh the roster so the ticket reflects my new claim.
                await refreshRoster()

                // Pin the resolved night so the geofence stays attached to the
                // exact occurrence (series tokens re-resolve weekly).
                if let n = detail?.night {
                    InviteClaimsStore.shared.add(
                        token: token, guestId: resp.guest.id,
                        nightDate: n.nightDate, lat: n.venueLat, lng: n.venueLng,
                        openTime: n.openTime, autoCheckin: n.autoCheckin ?? true)
                }
                Task { await LocationService.shared.syncGeofences() }
            } catch {
                self.error = "Couldn't add you to the list."
                Haptics.error()
            }
        }
    }

    // ── Ticket ───────────────────────────────────────────────────────────────

    private func refreshRoster() async {
        struct Resp: Decodable, Sendable { let guests: [InviteGuest] }
        if let resp: Resp = try? await api.get("/api/promoter-invites/\(token)") {
            guests = resp.guests
        }
    }

    /// User ids of everyone who has actually claimed a spot (= "going").
    private var claimedUserIds: Set<UUID> { Set(guests.compactMap { $0.claimedByUser }) }

    /// My own guest row (to read my open plus-ones + check-in state).
    private func myGuest(_ guestId: String) -> InviteGuest? {
        guests.first { $0.id.uuidString.lowercased() == guestId.lowercased() }
    }

    private func ticket(guestId: String, detail: InviteDetail) -> some View {
        let night = detail.night
        let invited = InvitedFriendsStore.load(token: token)
        let myPlusOnes = myGuest(guestId)?.plusOnes ?? 0
        return ScrollView {
            VStack(spacing: 18) {
                Text("YOU'RE ON THE LIST")
                    .font(.cfMono(11)).kerning(2)
                    .foregroundStyle(Theme.flame)
                Text(name)
                    .font(.cfSerif(34))
                    .foregroundStyle(Theme.parchment)
                Text("\(night.title ?? night.venueName) · \(Self.formatDate(night.nightDate))")
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.parchment.opacity(0.7))

                Image(uiImage: generateQR("fuoco-invite:\(guestId)"))
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 220, height: 220)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 16).fill(Color(hex: 0xFFF6E5)))

                Text("SHOW THIS AT THE DOOR")
                    .font(.cfMono(10)).kerning(1.5)
                    .foregroundStyle(Theme.parchment.opacity(0.5))

                // The reduced signup. It sits HERE, after the spot is already
                // theirs, rather than in front of the claim: a wizard between a
                // guest and an RSVP loses the guest, and the claim endpoint has
                // always accepted anonymous callers anyway.
                //
                // What it actually buys is keeping. An anonymous claim leaves
                // claimed_by_user null, so the spot exists only in this screen's
                // state — relaunch and the ticket is gone, it never reaches the
                // Tickets tab, and the Wallet URL is one nobody remembers.
                if !auth.hasAccount { saveSpotCard(guestId: guestId) }

                Link(destination: URL(string: "\(Self.baseURL)/api/promoter-invites/guest/\(guestId)/wallet")!) {
                    HStack(spacing: 8) {
                        Image(systemName: "wallet.pass.fill")
                        Text("Add to Apple Wallet").font(.cfSans(14, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(Capsule().fill(Color.black))
                }
                .padding(.top, 4)

                // ── Your party — editable: adjust open spots, invite friends ──
                partyCard(guestId: guestId)


                // ── Who's going: the roster (when the promoter makes it visible)
                if !guests.isEmpty {
                    rosterCard
                }

                Button("Done") { dismiss() }
                    .foregroundStyle(Theme.parchment.opacity(0.6))
                    .padding(.top, 10)
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 32)
        }
        .task {
            await refreshRoster()
            if !partyLoaded {
                partyPlusOnes = myGuest(guestId)?.plusOnes ?? 0
                invitedList = InvitedFriendsStore.load(token: token).map { InvitedFriend(id: $0.id, name: $0.name) }
                partyLoaded = true
            }
            // Poll gently while the ticket is open so acceptance status + the
            // roster stay live on their own. No pull-to-refresh — it fought
            // swipe-to-dismiss. Auto-cancels when the sheet closes.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 12_000_000_000)
                if Task.isCancelled { break }
                await refreshRoster()
            }
        }
        .sheet(isPresented: $showTicketFriendPicker) {
            FriendPickerSheet(excluded: excludedForInvite) { friend in
                assignFriendToSlot(friend)
            }
            .presentationDetents([.large])
        }
    }

    /// Everyone already in the party or already going — hidden from the picker.
    private var excludedForInvite: Set<UUID> {
        Set(invitedList.map { $0.id }).union(claimedUserIds)
    }

    /// The promoter's per-guest cap = total extra people you may bring.
    private var slotLimit: Int { detail?.night.maxPlusOnes ?? 0 }
    /// Slots you've filled (specific friends + open spots).
    private var usedSlots: Int { invitedList.count + partyPlusOnes }
    /// Room for another slot — bounded by the promoter cap AND live capacity.
    private var canAddSlot: Bool { usedSlots < slotLimit && partyPlusOnes < maxAllowedPlusOnes }

    /// Cap on open spots = min(night's per-guest cap, remaining allocation
    /// capacity after everyone else's heads and my own head).
    private var maxAllowedPlusOnes: Int {
        let cap = detail?.night.maxPlusOnes ?? 20
        let others = guests
            .filter { $0.id.uuidString.lowercased() != (claimedGuestId ?? "").lowercased() }
            .reduce(0) { $0 + 1 + $1.plusOnes }
        let spots = detail?.spots ?? Int.max
        return max(0, min(cap, spots - others - 1))
    }

    /// "Keep this spot" — one tap, no form.
    ///
    /// Name is already captured (they typed it to claim), and Apple supplies a
    /// verified identity without a keyboard, so this asks for nothing else.
    /// Birthday, email, gender and the survey all wait: the app blocks on a
    /// complete profile at the next launch, which is the right moment for them
    /// and the wrong moment for this one.
    @ViewBuilder
    private func saveSpotCard(guestId: String) -> some View {
        VStack(spacing: 12) {
            if attached {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.gold)
                    Text("Saved to your account")
                        .font(.cfSans(14, weight: .semibold))
                        .foregroundStyle(Theme.parchment)
                }
            } else {
                VStack(spacing: 4) {
                    Text("Keep this spot")
                        .font(.cfSerif(22)).foregroundStyle(Theme.parchment)
                    Text("Save it to your phone so it's here tomorrow, and in your tickets.")
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.parchment.opacity(0.65))
                        .multilineTextAlignment(.center)
                }

                if attaching {
                    ProgressView().tint(Theme.parchment)
                } else {
                    OAuthButtonsView(path: .constant([])) { _ in
                        // Deliberately ignoring `needsProfile`: the profile
                        // wizard is exactly what this lane exists to defer.
                        Task { await attachSpot(guestId: guestId) }
                    }
                }

                if let attachError {
                    Text(attachError)
                        .font(.cfSans(12)).foregroundStyle(Theme.flame)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 18).fill(Theme.parchment.opacity(0.06)))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.parchment.opacity(0.12)))
        .padding(.top, 6)
    }

    /// Bind the already-claimed spot to the account that just signed in.
    private func attachSpot(guestId: String) async {
        attaching = true
        attachError = nil
        defer { attaching = false }
        struct Resp: Decodable, Sendable { let attached: Bool }
        do {
            let _: Resp = try await api.post("/api/promoter-invites/guest/\(guestId)/attach")
            attached = true
            Haptics.success()
            // The Tickets tab can show it now.
            NotificationCenter.default.post(name: .cfInviteClaimed, object: nil)
        } catch {
            // They ARE signed in at this point — only the binding failed. Say so
            // plainly rather than implying the spot is gone, because it isn't:
            // the QR above still opens the door either way.
            attachError = "Signed in, but couldn't attach this spot. Your QR still works — pull it up from this link again."
            Haptics.error()
        }
    }

    private func partyCard(guestId: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("MY GUESTS").font(.cfMono(9)).kerning(1.5).foregroundStyle(Theme.parchment.opacity(0.5))
                Spacer()
                if partyBusy {
                    ProgressView().tint(Theme.parchment.opacity(0.6)).scaleEffect(0.7)
                } else if slotLimit > 0 {
                    // Total party vs the promoter's allowance (you + slots).
                    Text("\(1 + usedSlots)/\(1 + slotLimit)")
                        .font(.cfMono(9)).foregroundStyle(Theme.parchment.opacity(0.4))
                }
            }

            // Me
            partyRow(name: "\(name) (you)", trailing: myGuest(guestId)?.checkedInAt != nil ? .checkedIn : .going)

            // Friend slots — invited/going, removable while pending.
            ForEach(invitedList) { friend in
                let going = claimedUserIds.contains(friend.id)
                HStack(spacing: 10) {
                    Text(friend.name.isEmpty ? "Friend" : friend.name)
                        .font(.cfSans(14)).foregroundStyle(Theme.parchment).lineLimit(1)
                    Spacer(minLength: 8)
                    statusPill(going ? "GOING" : "INVITED", going ? Theme.gold : Theme.parchment.opacity(0.4), filled: false)
                    if !going { slotRemove { removeInvited(friend) } }
                }
            }

            // Open slots — each can be invited to (a friend) or left for the
            // shared link. Same slot, two ways to fill it.
            ForEach(Array(0..<partyPlusOnes), id: \.self) { _ in
                HStack(spacing: 10) {
                    Text("Open spot").font(.cfSans(14)).foregroundStyle(Theme.parchment.opacity(0.85))
                    Spacer(minLength: 8)
                    Button { Haptics.tap(); showTicketFriendPicker = true } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "person.badge.plus").font(.system(size: 12, weight: .semibold))
                            Text("Invite").font(.cfSans(12, weight: .semibold))
                        }
                        .foregroundStyle(Theme.ember)
                    }
                    .disabled(partyBusy)
                    statusPill("OPEN", Theme.parchment.opacity(0.35), filled: false)
                    slotRemove { changePlusOnes(partyPlusOnes - 1, guestId: guestId) }
                }
            }

            // Add a slot — only up to the promoter's per-guest limit.
            if canAddSlot {
                Button {
                    Haptics.tap(); changePlusOnes(partyPlusOnes + 1, guestId: guestId)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus.circle").font(.system(size: 16))
                        Text("Add a spot").font(.cfSans(14, weight: .medium))
                        Spacer()
                    }
                    .foregroundStyle(Theme.parchment.opacity(0.8))
                    .padding(.vertical, 2)
                }
                .disabled(partyBusy)
            } else if slotLimit > 0 && usedSlots >= slotLimit {
                Text("You've filled every spot the promoter allows.")
                    .font(.cfSans(11)).foregroundStyle(Theme.parchment.opacity(0.4))
            }

            // Share link — anyone who opens it takes one of your open spots.
            if partyPlusOnes > 0 {
                Rectangle().fill(Theme.parchment.opacity(0.1)).frame(height: 1).padding(.vertical, 2)
                ShareLink(item: inviteURL,
                          subject: Text(detail?.night.title ?? detail?.night.venueName ?? "Guestlist"),
                          message: Text("Join me on the guestlist")) {
                    fillButton(icon: "square.and.arrow.up", label: "Share link for open spots", filled: false)
                }
                .simultaneousGesture(TapGesture().onEnded { Haptics.tap() })
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(hex: 0x15110E)))
    }

    private func slotRemove(_ action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.parchment.opacity(0.4)).frame(width: 24, height: 24)
        }
        .disabled(partyBusy)
    }

    private func removeInvited(_ friend: InvitedFriend) {
        InvitedFriendsStore.remove(id: friend.id, token: token)
        invitedList.removeAll { $0.id == friend.id }
    }

    /// Fill one OPEN slot with a specific friend: the slot flips from open
    /// (anonymous +1) to that friend, so the total never grows past the cap.
    private func assignFriendToSlot(_ friend: FriendUser) {
        guard let gid = claimedGuestId else { return }
        if partyPlusOnes > 0 { changePlusOnes(partyPlusOnes - 1, guestId: gid) }
        inviteFriend(friend)
    }

    private func fillButton(icon: String, label: String, filled: Bool) -> some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold))
            Text(label).font(.cfSans(13, weight: .semibold))
        }
        .foregroundStyle(filled ? Color(hex: 0xFFF6E5) : Theme.parchment)
        .frame(maxWidth: .infinity)
        .frame(height: 44)
        .background(filled ? AnyShapeStyle(Theme.ember) : AnyShapeStyle(Color.clear), in: .capsule)
        .overlay { if !filled { Capsule().stroke(Theme.parchment.opacity(0.25)) } }
    }

    private func changePlusOnes(_ value: Int, guestId: String) {
        let v = max(0, min(value, maxAllowedPlusOnes))
        partyPlusOnes = v
        patchPlusOnes(v, guestId: guestId)
    }

    private func patchPlusOnes(_ value: Int, guestId: String) {
        partyBusy = true
        Task {
            defer { partyBusy = false }
            struct Body: Encodable { let plusOnes: Int
                enum CodingKeys: String, CodingKey { case plusOnes = "plus_ones" } }
            struct Resp: Decodable, Sendable { struct G: Decodable, Sendable { let plusOnes: Int }; let guest: G }
            do {
                let r: Resp = try await api.patch("/api/promoter-invites/guest/\(guestId)", body: Body(plusOnes: value))
                partyPlusOnes = r.guest.plusOnes
                await refreshRoster()
                Haptics.tap()
            } catch {
                partyPlusOnes = myGuest(guestId)?.plusOnes ?? partyPlusOnes   // revert
                Haptics.error()
            }
        }
    }

    private func inviteFriend(_ friend: FriendUser) {
        let name = friend.fullName ?? "Friend"
        InvitedFriendsStore.add(id: friend.id, name: name, token: token)
        if !invitedList.contains(where: { $0.id == friend.id }) {
            invitedList.append(InvitedFriend(id: friend.id, name: name))
        }
        Task {
            struct Body: Encodable { let userIds: [String]
                enum CodingKeys: String, CodingKey { case userIds = "user_ids" } }
            struct R: Decodable, Sendable { let sent: Int }
            let _: R? = try? await api.post("/api/promoter-invites/\(token)/invite-friends",
                                            body: Body(userIds: [friend.id.uuidString.lowercased()]))
            await refreshRoster()
        }
    }

    private var rosterCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("WHO'S GOING").font(.cfMono(9)).kerning(1.5).foregroundStyle(Theme.parchment.opacity(0.5))
                Spacer()
                Text("\(guests.reduce(0) { $0 + 1 + $1.plusOnes })")
                    .font(.cfMono(9)).foregroundStyle(Theme.parchment.opacity(0.4))
            }
            ForEach(guests) { g in
                partyRow(name: g.plusOnes > 0 ? "\(g.fullName) +\(g.plusOnes)" : g.fullName,
                         trailing: g.checkedInAt != nil ? .checkedIn : .none)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(hex: 0x15110E)))
    }

    private enum PartyStatus { case going, invited, open, checkedIn, none }

    private func partyRow(name: String, trailing: PartyStatus) -> some View {
        HStack(spacing: 10) {
            Text(name).font(.cfSans(14)).foregroundStyle(Theme.parchment).lineLimit(1)
            Spacer(minLength: 8)
            switch trailing {
            case .going:     statusPill("GOING", Theme.gold, filled: false)
            case .checkedIn: statusPill("CHECKED IN", Theme.gold, filled: true)
            case .invited:   statusPill("INVITED", Theme.parchment.opacity(0.4), filled: false)
            case .open:      statusPill("OPEN", Theme.parchment.opacity(0.35), filled: false)
            case .none:      EmptyView()
            }
        }
    }

    private func statusPill(_ text: String, _ color: Color, filled: Bool) -> some View {
        Text(text)
            .font(.cfMono(8, weight: .semibold)).kerning(1)
            .foregroundStyle(filled ? Color(hex: 0x141210) : color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(filled ? AnyShapeStyle(color) : AnyShapeStyle(color.opacity(0.15)), in: .capsule)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static func formatDate(_ ymd: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: ymd) else { return ymd }
        let out = DateFormatter(); out.dateFormat = "EEE d MMM"
        return out.string(from: d)
    }

    private func generateQR(_ string: String) -> UIImage {
        let data = string.data(using: .utf8)
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { return UIImage() }
        f.setValue(data, forKey: "inputMessage")
        f.setValue("H", forKey: "inputCorrectionLevel")
        guard let ci = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(ci, from: ci.extent)
        else { return UIImage() }
        return UIImage(cgImage: cg)
    }
}

// MARK: - Models

// APIClient's decoder is configured with `convertFromSnakeCase`, so explicit
// CodingKeys are intentionally omitted — the property names already match the
// camelCase form the strategy produces.
struct InviteDetail: Decodable, Sendable {
    let id: UUID
    let spots: Int
    let groupVisible: Bool
    let night: InviteNight
}
struct InviteNight: Decodable, Sendable {
    let id: UUID
    let title: String?
    let nightDate: String
    let openTime: String?
    let closeTime: String?
    let locationName: String?
    let address: String?
    let lat: Double?
    let lng: Double?
    let autoCheckin: Bool?
    let maxPlusOnes: Int?
    let club: InviteClub?

    /// Venue label — club name for partner clubs, custom name otherwise.
    var venueName: String { club?.name ?? locationName ?? "Location TBA" }
    /// Geofence coordinate — club coords, else the custom pin.
    var venueLat: Double? { club?.lat ?? lat }
    var venueLng: Double? { club?.lng ?? lng }
}
struct InviteClub: Decodable, Sendable {
    let id: UUID
    let name: String
    let address: String?
    let lat: Double?
    let lng: Double?
}
struct InviteGuest: Decodable, Sendable, Identifiable {
    let id: UUID
    let fullName: String
    let plusOnes: Int
    let claimedByUser: UUID?
    let checkedInAt: String?
}

/// Local record of which friends I assigned to slots on a given invite token,
/// so the ticket can show their acceptance status (Going once they appear in
/// the roster, otherwise Invited). Kept on-device — no schema change needed.
enum InvitedFriendsStore {
    private static func key(_ token: String) -> String { "cf.invited_friends.\(token)" }

    static func save(_ friends: [FriendUser], token: String) {
        let arr = friends.map { ["id": $0.id.uuidString, "name": $0.fullName ?? ""] }
        UserDefaults.standard.set(arr, forKey: key(token))
    }

    static func load(token: String) -> [(id: UUID, name: String)] {
        guard let arr = UserDefaults.standard.array(forKey: key(token)) as? [[String: String]] else { return [] }
        return arr.compactMap { d in UUID(uuidString: d["id"] ?? "").map { ($0, d["name"] ?? "") } }
    }

    /// Append one friend (deduped) — used when inviting from the ticket.
    static func add(id: UUID, name: String, token: String) {
        var arr = (UserDefaults.standard.array(forKey: key(token)) as? [[String: String]]) ?? []
        guard !arr.contains(where: { $0["id"] == id.uuidString }) else { return }
        arr.append(["id": id.uuidString, "name": name])
        UserDefaults.standard.set(arr, forKey: key(token))
    }

    static func remove(id: UUID, token: String) {
        var arr = (UserDefaults.standard.array(forKey: key(token)) as? [[String: String]]) ?? []
        arr.removeAll { $0["id"] == id.uuidString }
        UserDefaults.standard.set(arr, forKey: key(token))
    }
}

// MARK: - Local store of claimed invites (for geofence + revisit)

@MainActor
final class InviteClaimsStore {
    static let shared = InviteClaimsStore()
    // v2: claims now pin the resolved night (date + venue coords) so geofences
    // are built from local data — no per-sync network, and a series claim
    // stays attached to the exact week it was claimed for (the series token
    // re-resolves weekly, so we must NOT re-derive the night from the token).
    private let key = "cf.invite_claims.v3"

    struct Claim: Codable, Identifiable, Hashable {
        let token: String
        let guestId: String
        let nightDate: String      // yyyy-MM-dd of the claimed occurrence
        let lat: Double?
        let lng: Double?
        let openTime: String?      // "HH:mm:ss" for the geofence window
        var autoCheckin: Bool = true   // event-level: register a geofence?
        let claimedAt: Date
        var id: String { guestId }
    }

    func all() -> [Claim] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let v = try? JSONDecoder().decode([Claim].self, from: data)
        else { return [] }
        // Prune claims whose night is more than a day in the past.
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let cutoff = Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date()
        let live = v.filter { (f.date(from: $0.nightDate) ?? .distantFuture) >= cutoff }
        if live.count != v.count, let data = try? JSONEncoder().encode(live) {
            UserDefaults.standard.set(data, forKey: key)
        }
        return live
    }

    func add(token: String, guestId: String, nightDate: String,
             lat: Double?, lng: Double?, openTime: String?, autoCheckin: Bool) {
        var v = all().filter { $0.guestId != guestId }
        v.append(.init(token: token, guestId: guestId, nightDate: nightDate,
                       lat: lat, lng: lng, openTime: openTime,
                       autoCheckin: autoCheckin, claimedAt: Date()))
        if let data = try? JSONEncoder().encode(v) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    func remove(guestId: String) {
        let v = all().filter { $0.guestId != guestId }
        if let data = try? JSONEncoder().encode(v) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}

// MARK: - Slots + friend picker

/// One extra spot on the claim screen: either open (anonymous plus-one,
/// filled via the shared link) or a specific friend to invite.
enum InviteSlot: Identifiable, Hashable {
    case open(UUID)
    case friend(FriendUser)
    var id: UUID {
        switch self {
        case .open(let u):    return u
        case .friend(let f):  return f.id
        }
    }
}

/// Single-select friend picker used to fill a slot. Returns the chosen friend
/// to the caller (the targeted invite is sent when the claim is submitted).
/// Friends already assigned to other slots are excluded.
struct FriendPickerSheet: View {
    let excluded: Set<UUID>
    let onPick: (FriendUser) -> Void
    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var friends: [FriendUser] = []
    @State private var loading = true
    @State private var query = ""

    private var filtered: [FriendUser] {
        let available = friends.filter { !excluded.contains($0.id) }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return available }
        return available.filter { ($0.fullName ?? "").lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                content
            }
            .navigationTitle("Pick a friend")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.night, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.foregroundStyle(Theme.parchment.opacity(0.7))
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(Theme.parchment)
        } else if filtered.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "person.2").font(.system(size: 34)).foregroundStyle(Theme.parchment.opacity(0.3))
                Text(friends.isEmpty ? "No friends yet" : "Everyone's already added")
                    .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                if friends.isEmpty {
                    Text("Add friends from your profile, then invite them to spots here.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchment.opacity(0.5))
                        .multilineTextAlignment(.center).padding(.horizontal, 50)
                }
            }
        } else {
            List(filtered) { friend in
                Button {
                    Haptics.tap(); onPick(friend); dismiss()
                } label: {
                    HStack(spacing: 12) {
                        Circle().fill(Theme.parchment.opacity(0.12)).frame(width: 38, height: 38)
                            .overlay(Text(friend.initials).font(.cfSerif(15)).foregroundStyle(Theme.flame))
                        Text(friend.fullName ?? "Friend").font(.cfSans(16)).foregroundStyle(Theme.parchment)
                        Spacer()
                        Image(systemName: "plus.circle.fill").font(.system(size: 18)).foregroundStyle(Theme.ember)
                    }
                    .contentShape(.rect)
                }
                .listRowBackground(Color(hex: 0x15110E))
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search friends")
        }
    }

    private func load() async {
        loading = true
        if let data: FriendsData = try? await api.get("/api/friends") {
            friends = data.friends
        }
        loading = false
    }
}
