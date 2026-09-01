#!/usr/bin/env node
// Generates ClubFuoco/Core/Localization/Localizable.xcstrings from the web
// app's dictionaries (src/messages/{en,es}.ts) so native and web share one
// source of truth for copy. Re-run after editing the web dictionaries.
//
// Native-only keys (not present on web) live in NATIVE_KEYS below.

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..', '..')

function loadDict(lang) {
  const src = fs.readFileSync(path.join(repoRoot, 'src', 'messages', `${lang}.ts`), 'utf8')
  const body = src
    .replace(/export type[\s\S]*$/m, '')
    .replace(new RegExp(`export const ${lang} =`), 'return')
    .replace(/\} as const/, '}')
  return new Function(body)()
}

// Strings the native app needs that have no web equivalent (or that the web
// hardcodes in English). Both languages required.
const NATIVE_KEYS = {
  'common.loading': { en: 'Loading…', es: 'Cargando…' },
  'common.retry': { en: 'Retry', es: 'Reintentar' },
  'common.cancel': { en: 'Cancel', es: 'Cancelar' },
  'common.done': { en: 'Done', es: 'Hecho' },
  'common.error': { en: 'Something went wrong', es: 'Algo ha salido mal' },
  'bookings.empty': { en: 'Nothing booked yet', es: 'Todavía no tienes reservas' },
  'profile.accountType': { en: 'Account type', es: 'Tipo de cuenta' },
  'profile.membership': { en: 'Membership', es: 'Membresía' },

  // OAuth buttons (web hardcodes these in OAuthButtons.tsx)
  'auth.orContinueWith': { en: 'or continue with', es: 'o continúa con' },
  'auth.continueGoogle': { en: 'Continue with Google', es: 'Continuar con Google' },
  'auth.continueApple': { en: 'Continue with Apple', es: 'Continuar con Apple' },

  // Signup extras (hardcoded EN on web)
  'signup.stepLabel': { en: 'Step %@ / 03', es: 'Paso %@ / 03' },
  'signup.tagDiscover': { en: 'Discover clubs', es: 'Descubre clubs' },
  'signup.tagBook': { en: 'Book entry', es: 'Reserva entrada' },
  'signup.tagSave': { en: 'Save events', es: 'Guarda eventos' },
  'signup.trySigningIn': { en: 'Try signing in.', es: 'Prueba a iniciar sesión.' },
  'signup.emailTakenError': {
    en: 'This email is already registered. Try signing in instead.',
    es: 'Este correo ya está registrado. Prueba a iniciar sesión.',
  },
  'signup.phoneTakenError': {
    en: 'This phone number is already linked to another account.',
    es: 'Este teléfono ya está vinculado a otra cuenta.',
  },

  // Email verification (OTP) overlay
  'otp.title': { en: 'Check your', es: 'Revisa tu' },
  'otp.titleEm': { en: 'inbox', es: 'correo' },
  'otp.body': {
    en: 'We sent an 8-digit code to %@. Enter it below to confirm your email.',
    es: 'Hemos enviado un código de 8 dígitos a %@. Introdúcelo abajo para confirmar tu email.',
  },
  'otp.verify': { en: 'Verify email', es: 'Verificar email' },
  'otp.verifying': { en: 'Verifying…', es: 'Verificando…' },
  'otp.resend': { en: "Didn't get it? Resend code", es: '¿No llegó? Reenviar código' },
  'otp.resent': { en: 'Code re-sent ✓ — resend again', es: 'Código reenviado ✓ — reenviar de nuevo' },

  // Complete-profile (hardcoded EN on web)
  'completeProfile.title': { en: 'Almost', es: 'Casi' },
  'completeProfile.titleEm': { en: 'there', es: 'listo' },
  'completeProfile.subtitle': {
    en: "Sorry — we didn't get everything we need from your sign-in. Just fill in the last details and you're in.",
    es: 'Perdona — no recibimos todo lo necesario de tu inicio de sesión. Completa los últimos datos y estás dentro.',
  },
  'completeProfile.birthdayLabel': { en: 'Birthday · 18+', es: 'Cumpleaños · 18+' },
  'completeProfile.nameError': { en: 'Please enter your name.', es: 'Introduce tu nombre.' },
  'completeProfile.emailError': { en: 'Please enter your email.', es: 'Introduce tu email.' },
  'completeProfile.phoneError': { en: 'Please enter your phone number.', es: 'Introduce tu número de teléfono.' },
  'completeProfile.saving': { en: 'Saving…', es: 'Guardando…' },
  'completeProfile.enter': { en: 'Enter Club Fuoco', es: 'Entra en Club Fuoco' },

  // (signup.gender.* moved into src/messages/{en,es}.ts so web and iOS share)

  // Location-permission pre-prompt sheet (shown once per install on Tickets tab).
  // Copy goal: short + convincing + crystal-clear that we are NOT tracking them.
  // Nearby (Explore first-launch) — single OS dialog, WhenInUse only.
  'location.nearby.title': { en: 'Find the best clubs near you', es: 'Encuentra los mejores clubs cerca de ti' },
  'location.nearby.body': {
    en: "Allow location and we'll show the clubs closest to you tonight, sorted by how far they are from where you're standing. Used only while you have the app open — never in the background.",
    es: 'Activa la ubicación y te mostraremos los clubs más cercanos esta noche, ordenados por la distancia desde donde estés. Solo se usa con la app abierta — nunca en segundo plano.',
  },
  'location.nearby.enable': { en: 'Show clubs near me', es: 'Mostrar clubs cerca de mí' },
  // Single bold-highlighted instruction so the user knows exactly which OS
  // button to tap when the system dialog pops up after they hit the CTA.
  'location.nearby.tip': {
    en: 'When iOS asks, tap **Allow While Using App**.',
    es: 'Cuando iOS pregunte, toca **Permitir al usar la app**.',
  },


  'location.title': { en: 'Check you in automatically', es: 'Te registramos automáticamente' },
  'location.body': {
    en: 'On the night of your booking we draw a small circle around the venue. When you arrive, your pass updates — and nothing else. No background tracking, no map history, nothing between nights.',
    es: 'La noche de tu reserva trazamos un pequeño círculo alrededor del local. Cuando llegas, tu pase se actualiza — y nada más. Sin rastreo en segundo plano, sin historial de mapa, nada entre noches.',
  },
  // Numbered steps — iOS shows two separate dialogs back-to-back. Markdown
  // bold (**…**) is rendered via AttributedString so the button names pop.
  'location.stepsHeader': { en: 'iOS will show two prompts:', es: 'iOS mostrará dos diálogos:' },
  'location.step1': {
    en: 'Tap **Allow While Using App**',
    es: 'Toca **Permitir al usar la app**',
  },
  'location.step2': {
    en: 'Then tap **Change to Always Allow**',
    es: 'Después toca **Cambiar a Permitir siempre**',
  },
  'location.enable': { en: 'Enable arrival check-in', es: 'Activar check-in automático' },
  'location.notNow': { en: 'Not now', es: 'Ahora no' },
  'location.settingsTitle': { en: 'Almost — one more tap', es: 'Casi — un toque más' },
  'location.settingsBody': {
    en: "iOS didn't show the upgrade prompt. Switch Location to Always yourself:",
    es: 'iOS no mostró el segundo diálogo. Cambia la Ubicación a Siempre tú mismo:',
  },
  'location.settingsStep1': { en: 'Tap **Open Settings** below', es: 'Toca **Abrir Ajustes** abajo' },
  'location.settingsStep2': { en: 'Tap **Location**', es: 'Toca **Ubicación**' },
  'location.settingsStep3': { en: 'Choose **Always**', es: 'Elige **Siempre**' },
  'location.openSettings': { en: 'Open Settings', es: 'Abrir Ajustes' },

  // Settings-page extras (native-only sections).
  'settings.gender': { en: 'Gender', es: 'Género' },
  'settings.arrivalCheckIn': { en: 'Arrival check-in', es: 'Check-in al llegar' },
  'settings.arrivalStatus': { en: 'Status', es: 'Estado' },
  'settings.arrivalOn': { en: 'On — automatic', es: 'Activado — automático' },
  'settings.arrivalManualOnly': { en: 'Manual only', es: 'Solo manual' },
  'settings.arrivalOff': { en: 'Off', es: 'Desactivado' },
  'settings.arrivalNotSet': { en: 'Not set', es: 'Sin definir' },
  'settings.arrivalFooter': {
    en: 'Set Location to "Always" to check you in automatically the night of a booking. We only listen at the venue, only on the night.',
    es: 'Pon Ubicación en "Siempre" para registrarte automáticamente la noche de una reserva. Solo escuchamos en el local, solo esa noche.',
  },
  'settings.notificationsFooter': {
    en: 'Push notifications are managed in iOS Settings.',
    es: 'Las notificaciones push se gestionan en Ajustes de iOS.',
  },
  'settings.openIOSSettings': { en: 'Open iOS Settings', es: 'Abrir Ajustes de iOS' },
  'settings.upgradeToAlways': { en: 'Upgrade to Always', es: 'Cambiar a Siempre' },

  // Guest gating
  'gate.title': { en: 'Create an account to continue', es: 'Crea una cuenta para continuar' },

  // Explore chrome (hardcoded EN on web)
  'explore.subtitle': { en: 'Barcelona · Curated nightlife', es: 'Barcelona · Vida nocturna seleccionada' },
  'explore.points': { en: 'Points', es: 'Puntos' },
  'explore.searchPlaceholder': { en: 'Search clubs, neighbourhoods…', es: 'Busca clubs, barrios…' },
  'explore.noResults': { en: 'No clubs found for “%@”', es: 'No hay clubs para “%@”' },
  'explore.savedTitle': { en: 'I miei locali', es: 'I miei locali' },
  'explore.noSaved': { en: 'No saved clubs yet', es: 'Aún no tienes clubs guardados' },
  'explore.savedOne': { en: '1 club saved', es: '1 club guardado' },
  'explore.savedMany': { en: '%d clubs saved', es: '%d clubs guardados' },
  'explore.nothingSaved': { en: 'Nothing saved yet', es: 'Nada guardado todavía' },
  'explore.savedHint': { en: 'Tap the bookmark on any club to save it here', es: 'Toca el marcador en cualquier club para guardarlo aquí' },
  'explore.viewClub': { en: 'View Club', es: 'Ver club' },
  'explore.venuesArrow': { en: '%d venues →', es: '%d locales →' },
  'explore.open': { en: 'Open', es: 'Abierto' },
  'explore.featuredTonight': { en: 'Featured tonight', es: 'Destacado esta noche' },
  'explore.tonightPrefix': { en: 'Tonight:', es: 'Esta noche:' },
  'explore.featured': { en: 'Featured', es: 'Destacado' },
  'explore.noneNearby': { en: 'No clubs found nearby', es: 'No hay clubs cerca' },
  'explore.loadError': { en: 'Could not load nearby clubs', es: 'No se pudieron cargar los clubs cercanos' },
  // Dark feed ("Event Cards - App Front"). `seeAll` replaces the old
  // "%d venues →" header link. Cards carry no CTA label — the card itself is
  // the tap target — so there is no join/view string here.
  'explore.seeAll': { en: 'See all', es: 'Ver todo' },
  'explore.city': { en: 'Barcelona', es: 'Barcelona' },

  // Events tab — our own nights (promoter + house). `pickTag` is the editorial
  // pin surfaced to guests; the promoter's PAID `featured` flag is never
  // labelled, it only buys rank.
  'events.kicker': { en: 'Club Fuoco nights', es: 'Noches de Club Fuoco' },
  'events.more': { en: 'More nights', es: 'Más noches' },
  'events.lineup': { en: 'Line-up', es: 'Cartel' },
  'events.reserve': { en: 'Reserve a spot', es: 'Reservar plaza' },
  'events.reserving': { en: 'Reserving…', es: 'Reservando…' },
  'events.holdingSpot': { en: 'Holding your spot', es: 'Guardando tu plaza' },
  'events.fullTitle': { en: 'This night is full', es: 'Esta noche está llena' },
  'events.fullNote': { en: 'Room holds %d — reservations closed', es: 'Aforo %d — reservas cerradas' },
  'events.joinToReserve': { en: 'Join to reserve', es: 'Únete para reservar' },
  'events.joinNote': { en: 'Free account · takes a second', es: 'Cuenta gratis · un segundo' },
  'events.viewPass': { en: 'View pass', es: 'Ver pase' },
  'events.cancelRsvp': { en: 'Cancel', es: 'Cancelar' },
  'events.cancelTitle': { en: 'Give up your spot?', es: '¿Dejar tu plaza?' },
  'events.cancelConfirm': { en: 'Give up my spot', es: 'Dejar mi plaza' },
  'events.onTonight': { en: 'On tonight', es: 'Esta noche' },
  'events.about': { en: 'About', es: 'Sobre la noche' },
  'events.details': { en: 'Details', es: 'Detalles' },
  'events.when': { en: 'When', es: 'Cuándo' },
  'events.room': { en: 'Room', es: 'Sala' },
  'events.roomOf': { en: 'Room of %d', es: 'Aforo %d' },
  'events.roomHolds': { en: 'Holds %d', es: 'Aforo %d' },
  'events.entryNote': { en: 'Reserved spots only — no door sales', es: 'Solo plazas reservadas — sin venta en puerta' },
  'events.noLineup': { en: 'No line-up billed yet. Names go up here as they are confirmed.', es: 'Cartel por confirmar. Los nombres aparecerán aquí.' },
  'events.reserved': { en: "You're on the list", es: 'Estás en la lista' },
  'events.reserveHint': { en: 'Free entry — your pass appears under Tickets.', es: 'Entrada gratis — tu pase aparece en Entradas.' },
  'events.reservedHint': { en: 'Find your pass under Tickets.', es: 'Encuentra tu pase en Entradas.' },
  'events.tonight': { en: 'Tonight', es: 'Esta noche' },
  'events.thisWeek': { en: 'This week', es: 'Esta semana' },
  'events.later': { en: 'Later on', es: 'Más adelante' },
  'events.tonightTag': { en: 'Tonight', es: 'Esta noche' },
  'events.pickTag': { en: 'Our pick', es: 'Elección nuestra' },
  'events.oursTag': { en: 'Ours', es: 'Nuestro' },
  'events.free': { en: 'Free entry', es: 'Entrada gratis' },
  'events.entry': { en: 'Entry', es: 'Entrada' },
  'events.hostedBy': { en: 'Hosted by', es: 'Organizan' },
  'events.where': { en: 'Where', es: 'Dónde' },
  'events.emptyTitle': { en: 'Nothing on yet', es: 'Nada por ahora' },
  'events.emptyBody': {
    en: 'No nights are scheduled right now. Check back soon — or browse venues in Explore.',
    es: 'No hay noches programadas ahora mismo. Vuelve pronto o explora locales en Explorar.',
  },
  'events.loadError': { en: 'Could not load events', es: 'No se pudieron cargar los eventos' },

  // ── Backfill: keys referenced in Swift that had no catalog entry ──────────
  // `locale.t()` returns the key itself when it is missing, so each of these
  // was rendering literal text like "forgot.title" on screen. Found by diffing
  // every locale.t("…") in the Swift tree against the catalog.

  // Forgot-password wizard
  'forgot.kicker': { en: 'Reset access', es: 'Recuperar acceso' },
  'forgot.title': { en: 'Forgot your', es: '¿Olvidaste la' },
  'forgot.titleEm': { en: 'password?', es: 'contraseña?' },
  'forgot.emailSub': {
    en: 'Enter your email and we’ll send you an 8-digit code.',
    es: 'Introduce tu email y te enviaremos un código de 8 dígitos.',
  },
  'forgot.codeSub': {
    en: 'We sent a code to %@. Enter it below.',
    es: 'Hemos enviado un código a %@. Introdúcelo abajo.',
  },
  'forgot.passwordSub': {
    en: 'Choose a new password. At least 8 characters.',
    es: 'Elige una contraseña nueva. Mínimo 8 caracteres.',
  },
  'forgot.codeLabel': { en: 'Verification code', es: 'Código de verificación' },
  'forgot.newPassword': { en: 'New password', es: 'Contraseña nueva' },
  'forgot.resend': { en: 'Resend code', es: 'Reenviar código' },
  'forgot.resendIn': { en: 'Resend in %ds', es: 'Reenviar en %ds' },
  'forgot.sendCode': { en: 'Send code', es: 'Enviar código' },
  'forgot.verify': { en: 'Verify code', es: 'Verificar código' },
  'forgot.setPassword': { en: 'Set password', es: 'Guardar contraseña' },
  'forgot.working': { en: 'Working…', es: 'Un momento…' },
  'forgot.codeError': {
    en: 'That code isn’t right, or it has expired.',
    es: 'Ese código no es correcto o ha caducado.',
  },

  // Help sheet (from a booking)
  'help.title': { en: 'Get help', es: 'Ayuda' },
  'help.subtitle': {
    en: 'Tell us what’s wrong with this booking and we’ll come back to you by email.',
    es: 'Cuéntanos qué pasa con esta reserva y te responderemos por email.',
  },
  'help.urgent': { en: 'At the door right now?', es: '¿Estás en la puerta?' },
  'help.urgentBody': {
    en: 'Show your pass to the door team — they can look you up by the reference below.',
    es: 'Enseña tu pase en puerta — pueden buscarte con la referencia de abajo.',
  },
  'help.reference': { en: 'Booking reference', es: 'Referencia de la reserva' },
  'help.describe': { en: 'What happened?', es: '¿Qué ha pasado?' },
  'help.failed': {
    en: 'That didn’t send. Check your connection and try again.',
    es: 'No se ha enviado. Revisa la conexión e inténtalo de nuevo.',
  },
  'help.sentTitle': { en: 'Message sent', es: 'Mensaje enviado' },
  'help.sentBody': {
    en: 'We’ve got it. Expect a reply by email within a day.',
    es: 'Lo hemos recibido. Te responderemos por email en un día.',
  },
  'common.close': { en: 'Close', es: 'Cerrar' },

  // Booking detail
  'bookings.receipt': { en: 'Receipt', es: 'Recibo' },
  'bookings.serviceFee': { en: 'Service fee', es: 'Gastos de gestión' },
  'bookings.included': { en: 'Included', es: 'Incluidos' },
  'bookings.totalPaid': { en: 'Total paid', es: 'Total pagado' },
  'bookings.where': { en: 'Where', es: 'Dónde' },
  'bookings.manage': { en: 'Manage', es: 'Gestionar' },
  'bookings.shareTicket': { en: 'Share ticket', es: 'Compartir entrada' },
  'bookings.factGuestlist': { en: 'Guestlist', es: 'Lista' },

  // Bookings list — group invites
  'bookings.invited': { en: 'Invited', es: 'Invitación' },
  'bookings.invitedRespond': { en: 'Tap to respond', es: 'Toca para responder' },
  'bookings.aNightOut': { en: 'A night out', es: 'Una noche fuera' },

  // Club detail
  'detail.fuocoScore': { en: 'Fuoco score', es: 'Puntuación Fuoco' },
  'detail.seeAll': { en: 'See all %d', es: 'Ver los %d' },
  'detail.showLess': { en: 'Show less', es: 'Ver menos' },

  // Featured DJ box + player
  'dj.sheetLabel': { en: 'Resident', es: 'Residente' },
  'dj.residencyHere': { en: 'Residency here', es: 'Residencia aquí' },
  'dj.upcoming': { en: 'Upcoming', es: 'Próximas fechas' },
  'dj.noDates': { en: 'No dates announced', es: 'Sin fechas anunciadas' },
  'dj.comingSoonShort': { en: 'Date coming soon', es: 'Fecha por confirmar' },
  'dj.cityComingSoon': { en: '%@ · date coming soon', es: '%@ · fecha por confirmar' },
  'dj.guestOnlyNote': {
    en: 'Create a free account to see full dates and join guestlists.',
    es: 'Crea una cuenta gratis para ver todas las fechas y unirte a las listas.',
  },
  'dj.joinGuestlist': { en: 'Join the guestlist', es: 'Únete a la lista' },
  'dj.soundcloudPreview': { en: 'Preview', es: 'Vista previa' },
  'dj.previewUnavailable': { en: 'Preview unavailable', es: 'Vista previa no disponible' },
  'dj.loadingTrack': { en: 'Loading…', es: 'Cargando…' },

  // Scraped-event sheet on a club page (distinct from our own `events.*`)
  'event.label': { en: 'Event', es: 'Evento' },
  'event.entry': { en: 'Door', es: 'Puerta' },
  'event.capacity': { en: 'Capacity', es: 'Aforo' },
  'event.interestedCount': { en: '%@ interested', es: '%@ interesados' },
  'event.lineup': { en: 'Line-up', es: 'Cartel' },
  'event.noLineup': { en: 'No line-up listed', es: 'Sin cartel publicado' },
  'event.headliner': { en: 'Headlining', es: 'Cabeza de cartel' },
  'event.venue': { en: 'Venue', es: 'Local' },

  // Misc
  'explore.shelfCount': { en: '%d venues', es: '%d locales' },
  'auth.phoneOptional': { en: 'Phone · optional', es: 'Teléfono · opcional' },
  'gate.keepBrowsing': { en: 'Browsing stays free', es: 'Explorar es siempre gratis' },
  'rumbalist.guestsNoApp': { en: 'Guests without the app', es: 'Invitados sin la app' },
  'rumbalist.guestsNoAppNote': {
    en: 'They’ll get a link to join your list.',
    es: 'Recibirán un enlace para unirse a tu lista.',
  },
  'settings.lang.ca': { en: 'Català', es: 'Català' },
  'settings.lang.fr': { en: 'Français', es: 'Français' },
  'settings.theme': { en: 'Appearance', es: 'Apariencia' },
  'settings.theme.system': { en: 'System', es: 'Sistema' },
  'settings.theme.light': { en: 'Light', es: 'Claro' },
  'settings.theme.dark': { en: 'Dark', es: 'Oscuro' },

  'plan.tonight': { en: 'Tonight', es: 'Esta noche' },
  'plan.tomorrow': { en: 'Tomorrow', es: 'Mañana' },
  'plan.next': { en: 'Next', es: 'Próximo' },

  // Filter chips
  'chip.all': { en: 'All', es: 'Todo' },
  'chip.free': { en: 'Free', es: 'Gratis' },
  'chip.cocktails': { en: 'Cocktails', es: 'Cócteles' },
  'chip.live': { en: 'Live Music', es: 'Música en directo' },
  'chip.dancing': { en: 'Dancing', es: 'Baile' },
  'chip.rooftop': { en: 'Rooftop', es: 'Azotea' },
  'chip.techno': { en: 'Techno', es: 'Techno' },
  'chip.house': { en: 'House', es: 'House' },
  'chip.latin': { en: 'Latin', es: 'Latino' },

  // Bookings (hardcoded EN on web)
  'bookings.tonight': { en: 'Tonight', es: 'Esta noche' },
  'bookings.upcoming': { en: 'Upcoming', es: 'Próximas' },
  'bookings.noUpcoming': { en: 'No upcoming bookings', es: 'No tienes reservas próximas' },
  'bookings.noUpcomingSub': {
    en: 'When you book a night, it’ll show up here.',
    es: 'Cuando reserves una noche, aparecerá aquí.',
  },
  'bookings.noUpcomingPast': {
    en: 'Nothing coming up — check your past bookings below.',
    es: 'Nada próximo — consulta tus reservas pasadas abajo.',
  },
  'bookings.past': { en: 'Past', es: 'Pasadas' },
  'bookings.showPast': { en: 'Show past', es: 'Ver pasadas' },
  'bookings.hidePast': { en: 'Hide past', es: 'Ocultar pasadas' },
  'bookings.cancelBooking': { en: 'Cancel booking', es: 'Cancelar reserva' },
  'bookings.cancelQuestion': { en: 'Cancel this booking?', es: '¿Cancelar esta reserva?' },
  'bookings.keep': { en: 'Keep booking', es: 'Mantener reserva' },
  'bookings.yesCancel': { en: 'Yes, cancel', es: 'Sí, cancelar' },
  'bookings.cancelled': { en: 'Booking cancelled.', es: 'Reserva cancelada.' },
  'bookings.refund': { en: 'Cancelled — €%@ refund on its way', es: 'Cancelada — reembolso de %@ € en camino' },
  'bookings.showQR': { en: 'Show QR', es: 'Mostrar QR' },
  'bookings.atDoor': { en: 'Show this at the door', es: 'Muestra esto en la puerta' },
  'bookings.guestList': { en: 'Guest list', es: 'Lista de invitados' },
  // Gold pill on a claimed promoter-guestlist pass. Stored uppercase — the
  // pill renders the value verbatim (no .textCase in the view).
  'bookings.guestlistTag': { en: 'GUESTLIST', es: 'LISTA' },
  'bookings.partyOf': { en: 'Party of %d', es: 'Grupo de %d' },
  'bookings.general': { en: 'General entry', es: 'Entrada general' },
  'bookings.vip': { en: 'VIP table', es: 'Mesa VIP' },
  'bookings.statusConfirmed': { en: 'Confirmed', es: 'Confirmada' },
  'bookings.statusPending': { en: 'Pending', es: 'Pendiente' },
  'bookings.statusCancelled': { en: 'Cancelled', es: 'Cancelada' },
  'bookings.statusCheckedIn': { en: 'Checked in', es: 'Registrado' },
  'bookings.tickets': { en: '%d × tickets', es: '%d × entradas' },
  'bookings.nightlife': { en: 'Nightlife · Barcelona', es: 'Vida nocturna · Barcelona' },
  'bookings.factDate': { en: 'Date', es: 'Fecha' },
  'bookings.factDoors': { en: 'Doors', es: 'Apertura' },
  'bookings.factGuests': { en: 'Guests', es: 'Personas' },
  'bookings.factTicket': { en: 'Ticket', es: 'Entrada' },
  'bookings.detailTitle': { en: 'Reservation', es: 'Reserva' },
  'bookings.factStatus': { en: 'Status', es: 'Estado' },
  'bookings.factArrival': { en: 'Arrival', es: 'Llegada' },
  'bookings.tonightBadge': { en: 'Tonight', es: 'Esta noche' },

  // Profile (hardcoded EN/IT on web)
  'profile.header': { en: 'CLUB FUOCO · ACCOUNT', es: 'CLUB FUOCO · CUENTA' },
  'profile.member': { en: 'Member', es: 'Miembro' },
  'profile.socio': { en: 'SOCIO', es: 'SOCIO' },
  'profile.statNights': { en: 'Nights', es: 'Noches' },
  'profile.statSaved': { en: 'Saved', es: 'Guardados' },
  'profile.statFriends': { en: 'Friends', es: 'Amigos' },
  'profile.accountSection': { en: 'N° 02 · Il tuo account', es: 'N° 02 · Il tuo account' },
  'profile.prefsSection': { en: 'N° 03 · Preferenze', es: 'N° 03 · Preferenze' },
  'profile.myBookings': { en: 'My Bookings', es: 'Mis reservas' },
  'profile.bookingsCount': { en: '%d bookings', es: '%d reservas' },
  'profile.bookingsCountOne': { en: '%d booking', es: '%d reserva' },
  'profile.savedClubs': { en: 'Saved Clubs', es: 'Clubs guardados' },
  'profile.savedCount': { en: '%d saved', es: '%d guardados' },
  'profile.friends': { en: 'Friends', es: 'Amigos' },
  'profile.settingsRow': { en: 'Settings', es: 'Ajustes' },
  'profile.settingsSub': { en: 'Notifications · privacy · language', es: 'Notificaciones · privacidad · idioma' },
  'profile.help': { en: 'Help & Support', es: 'Ayuda y soporte' },
  'profile.helpSub': { en: 'FAQ · contact concierge', es: 'FAQ · contacta al concierge' },
  'profile.legal': { en: 'House Rules & Privacy', es: 'Normas y privacidad' },
  'profile.legalSub': { en: 'Terms · privacy · GDPR', es: 'Términos · privacidad · RGPD' },
  'profile.terms': { en: 'Terms of Use', es: 'Términos de uso' },
  'profile.termsSub': { en: 'House rules · memberships · liability', es: 'Normas · membresías · responsabilidad' },
  'profile.privacy': { en: 'Privacy Policy', es: 'Política de privacidad' },
  'profile.privacySub': { en: 'How we handle your data · GDPR rights', es: 'Cómo tratamos tus datos · derechos RGPD' },
  'profile.footerCompany': { en: 'FUOCO · A NIGHTLIFE COMPANY', es: 'FUOCO · A NIGHTLIFE COMPANY' },
  'profile.footerQuote': { en: '“La notte ci appartiene.”', es: '“La notte ci appartiene.”' },

  // Friends (hardcoded EN on web)
  'friends.title': { en: 'Friends', es: 'Amigos' },
  'friends.addFriend': { en: 'Add a friend', es: 'Añade un amigo' },
  'friends.searchPlaceholder': { en: 'Search by name or email', es: 'Busca por nombre o email' },
  'friends.searching': { en: 'Searching…', es: 'Buscando…' },
  'friends.noneFound': { en: 'No one found for “%@”', es: 'Nadie encontrado para “%@”' },
  'friends.requests': { en: 'Requests', es: 'Solicitudes' },
  'friends.sent': { en: 'Sent', es: 'Enviadas' },
  'friends.yourFriends': { en: 'Your Friends', es: 'Tus amigos' },
  'friends.add': { en: 'Add', es: 'Añadir' },
  'friends.accept': { en: 'Accept', es: 'Aceptar' },
  'friends.decline': { en: 'Decline', es: 'Rechazar' },
  'friends.pending': { en: 'Pending', es: 'Pendiente' },
  'friends.requested': { en: 'Requested', es: 'Solicitado' },
  'friends.friends': { en: 'Friends', es: 'Amigos' },
  'friends.added': { en: 'Added', es: 'Añadido' },
  'friends.empty': {
    en: 'No friends yet — search above to add people you go out with.',
    es: 'Aún no tienes amigos — busca arriba para añadir a la gente con la que sales.',
  },

  // Groups (hardcoded EN on web)
  'groups.strip': { en: 'Group Nights', es: 'Noches en grupo' },
  'groups.going': { en: '%d going', es: '%d van' },
  'groups.invited': { en: 'Invited', es: 'Invitado' },
  'groups.maybe': { en: 'Maybe', es: 'Quizás' },
  'groups.declined': { en: 'Declined', es: 'Rechazado' },
  'groups.join': { en: 'Join', es: 'Unirme' },
  'groups.joinFor': { en: 'Join · %@', es: 'Unirme · %@' },
  'groups.organizer': { en: 'Organizer', es: 'Organizador' },
  'groups.paid': { en: 'Paid', es: 'Pagado' },
  'groups.statusOpen': { en: 'Open', es: 'Abierto' },
  'groups.statusClosed': { en: 'Closed', es: 'Cerrado' },
  'groups.statusCancelled': { en: 'Cancelled', es: 'Cancelada' },
  'groups.inviteFriends': { en: 'Invite friends', es: 'Invitar amigos' },
  'groups.invite': { en: 'Invite', es: 'Invitar' },
  'groups.remind': { en: 'Remind everyone', es: 'Recordar a todos' },
  'groups.reminded': { en: 'Reminded %d', es: 'Recordados %d' },
  'groups.everyoneResponded': { en: 'Everyone responded', es: 'Todos respondieron' },
  'groups.cancelNight': { en: 'Call off this night', es: 'Cancelar la noche' },
  'groups.cancelConfirm': { en: 'Call off this night for everyone?', es: '¿Cancelar la noche para todos?' },
  'groups.share': { en: 'Share invite', es: 'Compartir invitación' },
  'groups.shareText': {
    en: 'Come out to %@ on %@ — join my group on Club Fuoco',
    es: 'Ven a %@ el %@ — únete a mi grupo en Club Fuoco',
  },
  'groups.paymentNeeded': {
    en: 'Paid spots need in-app payment — coming later this phase. Use the invite link on the web for now.',
    es: 'Las plazas de pago necesitan pago en la app — llega pronto. De momento usa el enlace de invitación en la web.',
  },
  'groups.notFound': { en: 'Group not found', es: 'Grupo no encontrado' },
  'bookings.groupTag': { en: 'Group', es: 'Grupo' },
  'bookings.seeWhosGoing': { en: "See who's going", es: 'Ver quién va' },
  'groups.yourSpot': { en: 'Your spot', es: 'Tu plaza' },
  'groups.yourPass': { en: 'Your pass', es: 'Tu pase' },
  'groups.addToCalendar': { en: 'Add to calendar', es: 'Añadir al calendario' },
  'groups.calendarAdded': { en: 'Added to your calendar', es: 'Añadido a tu calendario' },
  'groups.calendarError': { en: "Couldn't add to calendar", es: 'No se pudo añadir al calendario' },
  'groups.calendarTitle': { en: 'Night at %@', es: 'Noche en %@' },
  'groups.calendarNotes': {
    en: 'Your Club Fuoco group night. Show your pass at the door.',
    es: 'Tu noche de grupo en Club Fuoco. Muestra tu pase en la puerta.',
  },

  // Group chat
  'groupChat.open': { en: 'Group chat', es: 'Chat del grupo' },
  'groupChat.subtitle': { en: 'Sort the meet-up, times, running late', es: 'Organiza el punto de encuentro y la hora' },
  'groupChat.empty': { en: 'No messages yet — say hi 👋', es: 'Aún no hay mensajes — saluda 👋' },
  'groupChat.placeholder': { en: 'Message the group…', es: 'Escribe al grupo…' },

  // Rumbas (hardcoded EN on web)
  'rumba.spotsLeft': { en: '%d spots left', es: '%d plazas libres' },
  'rumba.dressCode': { en: 'Dress code: %@', es: 'Código de vestimenta: %@' },
  'rumba.joinList': { en: 'Join the list', es: 'Apúntate a la lista' },
  'rumba.yourName': { en: 'Your name', es: 'Tu nombre' },
  'rumba.plusOnes': { en: 'Plus ones', es: 'Acompañantes' },
  'rumba.onList': { en: "You're on the list", es: 'Estás en la lista' },
  'rumba.waitlist': { en: 'Waitlist', es: 'Lista de espera' },
  'shelf.rumbas.title': { en: "Tonight's Guest Lists", es: 'Las listas de esta noche' },
  'shelf.rumbas.sub': { en: 'Exclusive guest list events', es: 'Eventos exclusivos con lista' },
  'explore.eventsArrow': { en: '%d events →', es: '%d eventos →' },

  // Fiamme (hardcoded EN/IT on web)
  'fiamme.available': { en: '%@ Fiamme available', es: '%@ Fiamme disponibles' },
  'fiamme.balanceSection': { en: 'N° 01 · Saldo', es: 'N° 01 · Saldo' },
  'fiamme.tierSection': { en: 'N° 02 · Tier', es: 'N° 02 · Nivel' },
  'fiamme.rewardsSection': { en: 'N° 03 · Rewards', es: 'N° 03 · Recompensas' },
  'fiamme.earnSection': { en: 'N° 04 · How to earn', es: 'N° 04 · Cómo ganar' },
  'fiamme.activitySection': { en: 'N° 05 · Activity', es: 'N° 05 · Actividad' },
  'fiamme.redeem': { en: 'Redeem', es: 'Canjear' },
  'fiamme.redeemQuestion': { en: 'Redeem %@ for %d Fiamme?', es: '¿Canjear %@ por %d Fiamme?' },
  'fiamme.insufficient': { en: 'Not enough Fiamme', es: 'No tienes suficientes Fiamme' },
  'fiamme.showCode': { en: 'Show this code at the venue', es: 'Muestra este código en el local' },
  'fiamme.expires': { en: 'Valid 24h · one use', es: 'Válido 24 h · un solo uso' },
  'fiamme.noActivity': { en: 'No activity yet', es: 'Aún no hay actividad' },
  'fiamme.reward.comp_drink': { en: 'Comp drink', es: 'Copa de cortesía' },
  'fiamme.reward.comp_drink.desc': { en: 'House cocktail, any partner', es: 'Cóctel de la casa en cualquier socio' },
  'fiamme.reward.skip_line': { en: 'Skip the line', es: 'Sáltate la cola' },
  'fiamme.reward.skip_line.desc': { en: 'Walk in front, any night', es: 'Entra el primero cualquier noche' },
  'fiamme.reward.free_cover': { en: 'Free cover', es: 'Entrada gratis' },
  'fiamme.reward.free_cover.desc': { en: 'Up to €30 entry fee waived', es: 'Hasta 30 € de entrada gratis' },
  'fiamme.reward.bottle_deposit': { en: 'Bottle deposit', es: 'Depósito de botella' },
  'fiamme.reward.bottle_deposit.desc': { en: 'Toward bottle service', es: 'Para servicio de botella' },
  'fiamme.tier.nuovo': { en: 'Newcomer', es: 'Nuevo' },
  'fiamme.tier.regolare': { en: 'Regular', es: 'Habitual' },
  'fiamme.tier.conoscitore': { en: 'Connoisseur', es: 'Conocedor' },
  'fiamme.tier.tastemaker': { en: 'Tastemaker', es: 'Creador de tendencias' },
  'fiamme.earn1': { en: 'Verified review', es: 'Reseña verificada' },
  'fiamme.earn1.desc': { en: 'After your booking, write a short note.', es: 'Tras tu reserva, escribe una nota corta.' },
  'fiamme.earn2': { en: 'First at the venue', es: 'El primero en el local' },
  'fiamme.earn2.desc': { en: 'Be the first to review a partner club.', es: 'Sé el primero en reseñar un club socio.' },
  'fiamme.earn3': { en: 'Weekly streak', es: 'Racha semanal' },
  'fiamme.earn3.desc': { en: 'Review every week, four weeks running.', es: 'Reseña cada semana durante cuatro semanas.' },

  // Notifications screen
  'notifications.title': { en: 'Notifications', es: 'Notificaciones' },
  'notifications.empty': { en: 'No notifications yet', es: 'Aún no hay notificaciones' },
  'time.justNow': { en: 'just now', es: 'ahora mismo' },
  'time.minsAgo': { en: '%dm ago', es: 'hace %dm' },
  'time.hrsAgo': { en: '%dh ago', es: 'hace %dh' },
  'time.daysAgo': { en: '%dd ago', es: 'hace %dd' },

  // Membership + IAP
  'membership.current': { en: 'Current plan', es: 'Plan actual' },
  'membership.subscribe': { en: 'Subscribe', es: 'Suscribirse' },
  'membership.restore': { en: 'Restore Purchases', es: 'Restaurar compras' },
  'membership.manage': { en: 'Manage subscription', es: 'Gestionar suscripción' },
  'membership.unavailable': {
    en: 'Subscriptions are unavailable right now. Try again later.',
    es: 'Las suscripciones no están disponibles ahora mismo. Inténtalo más tarde.',
  },
  'membership.verifying': { en: 'Verifying purchase…', es: 'Verificando compra…' },
  'membership.active': { en: 'Membership active: %@', es: 'Membresía activa: %@' },
  'membership.perMonth': { en: '/month', es: '/mes' },
  'membership.noRestore': { en: 'No purchases to restore', es: 'No hay compras que restaurar' },
  'perk.gold.1': { en: 'Priority entry at partner clubs', es: 'Entrada prioritaria en clubs socios' },
  'perk.gold.2': { en: '15% discount on bookings at partner clubs', es: '15% de descuento en reservas en clubs socios' },
  'perk.gold.3': { en: 'Monthly guest pass (x1)', es: 'Pase de invitado mensual (x1)' },
  'perk.gold.4': { en: 'Early access to event announcements', es: 'Acceso anticipado a los anuncios de eventos' },
  'perk.sapphire.1': { en: '25% discount on bookings at partner clubs', es: '25% de descuento en reservas en clubs socios' },
  'perk.sapphire.2': { en: 'Complimentary guest list access (up to 4×/month)', es: 'Acceso gratuito a listas (hasta 4×/mes)' },
  'perk.sapphire.3': { en: 'Personal concierge via WhatsApp', es: 'Concierge personal por WhatsApp' },
  'perk.sapphire.4': { en: 'Invite-only afterhours events', es: 'Afterhours solo con invitación' },
  'perk.black.1': { en: 'Free VIP entry at all partner clubs', es: 'Entrada VIP gratis en todos los clubs socios' },
  'perk.black.2': { en: '30% discount on all bookings at partner clubs', es: '30% de descuento en todas las reservas en clubs socios' },
  'perk.black.3': { en: 'Complimentary guest list access (unlimited)', es: 'Acceso gratuito a listas (ilimitado)' },
  'perk.black.4': { en: 'Dedicated 24/7 concierge', es: 'Concierge dedicado 24/7' },
  'perk.black.5': { en: 'Invite-only afterhours & private events', es: 'Afterhours y eventos privados solo con invitación' },
  'perk.black.6': { en: 'Early access to every new partner club', es: 'Acceso anticipado a cada nuevo club socio' },

  // Booking purchase (Apple Pay)
  'book.cta': { en: 'Book Your Night', es: 'Reserva tu noche' },
  'book.partySize': { en: 'Party size', es: 'Tamaño del grupo' },
  'book.subtotal': { en: 'Subtotal', es: 'Subtotal' },
  'book.discount': { en: 'Membership discount', es: 'Descuento de membresía' },
  'book.total': { en: 'Total', es: 'Total' },
  'book.applePayUnavailable': {
    en: "Apple Pay isn't set up on this device",
    es: 'Apple Pay no está configurado en este dispositivo',
  },
  'book.confirmed': {
    en: 'Booking confirmed — your QR is in Tickets',
    es: 'Reserva confirmada — tu QR está en Entradas',
  },
  'book.planWithFriends': { en: 'Plan it with friends instead', es: 'Mejor planéalo con amigos' },
  'book.groupCreated': {
    en: 'Group created — invite code %@. Find it in Tickets.',
    es: 'Grupo creado — código %@. Lo tienes en Entradas.',
  },
  'book.entry': { en: 'Entry · %@', es: 'Entrada · %@' },

  // Rumbalist offers
  'rumbalist.tonightWith': { en: 'Tonight with', es: 'Esta noche con' },
  'rumbalist.bookVenue': { en: 'Book this venue', es: 'Reserva este local' },
  'rumbalist.tonightOptions': { en: "Tonight's options", es: 'Opciones de esta noche' },
  // Shown when a future night is selected; %@ is the night ("Friday", "Tomorrow").
  'rumbalist.optionsFor': { en: 'Options for %@', es: 'Opciones para %@' },
  'rumbalist.join': { en: 'Join →', es: 'Unirme →' },
  'rumbalist.book': { en: 'Book →', es: 'Reservar →' },
  'rumbalist.with': { en: 'with', es: 'con' },
  'rumbalist.confirmationNote': {
    en: 'Confirmation lands on your Tickets tab instantly.',
    es: 'La confirmación llega a tu pestaña de Entradas al instante.',
  },
  'rumbalist.titleFree': { en: 'Free Guestlist', es: 'Lista gratis' },
  'rumbalist.titleVip': { en: 'VIP Table', es: 'Mesa VIP' },
  'rumbalist.joinGuestlistAt': { en: 'Join the guestlist at', es: 'Únete a la lista en' },
  'rumbalist.payClubFuoco': { en: 'Pay Club Fuoco', es: 'Paga a Club Fuoco' },
  'rumbalist.operator': { en: 'Operator', es: 'Operador' },
  'rumbalist.payTo': { en: 'Pay to', es: 'Pagar a' },
  'rumbalist.via': { en: 'via', es: 'vía' },
  'rumbalist.venue': { en: 'Venue', es: 'Local' },
  'rumbalist.address': { en: 'Address', es: 'Dirección' },
  'rumbalist.valid': { en: 'Valid', es: 'Válido' },
  'rumbalist.dressCode': { en: 'Dress code', es: 'Código de vestimenta' },
  'rumbalist.date': { en: 'Date', es: 'Fecha' },
  'rumbalist.offer': { en: 'Offer', es: 'Oferta' },
  'rumbalist.time': { en: 'Time', es: 'Horario' },
  'rumbalist.reference': { en: 'Reference', es: 'Referencia' },
  'rumbalist.savedToTickets': {
    en: 'Saved to your Tickets tab — find it there anytime.',
    es: 'Guardado en tu pestaña Entradas: encuéntralo cuando quieras.',
  },
  'rumbalist.validNight': { en: '%@ only', es: 'Solo %@' },
  'rumbalist.worksUntil': { en: 'Works until %@', es: 'Válido hasta %@' },
  'rumbalist.validNote': {
    en: 'Valid for this night only, while the venue keeps accepting the guest list.',
    es: 'Válido solo para esta noche, mientras el local siga aceptando la lista.',
  },
  'rumbalist.total': { en: 'Total', es: 'Total' },
  'rumbalist.free': { en: 'Free', es: 'Gratis' },
  'rumbalist.freeGuestlist': { en: 'Join Free Guestlist', es: 'Únete a la lista gratis' },
  'rumbalist.openingApplePay': { en: 'Opening Apple Pay…', es: 'Abriendo Apple Pay…' },
  'rumbalist.pay': { en: 'Pay', es: 'Pagar' },
  'rumbalist.freeFooter': {
    en: "You're added to the door list. Ticket lands on your Tickets tab.",
    es: 'Estás en la lista de la puerta. Tu entrada llega a la pestaña de Entradas.',
  },
  'rumbalist.vipFooter': {
    en: 'Your table is booked. Confirmation on your Tickets tab.',
    es: 'Tu mesa está reservada. Confirmación en la pestaña de Entradas.',
  },
  'rumbalist.onDoorList': { en: "You're on the door list", es: 'Estás en la lista de la puerta' },
  'rumbalist.tableBooked': { en: 'Your table is booked', es: 'Tu mesa está reservada' },
  'rumbalist.atDoor': { en: 'Show this at the door', es: 'Muestra esto en la puerta' },
  'rumbalist.bringCrew': { en: 'Bring your crew', es: 'Trae a tu gente' },
  'rumbalist.bringCrewNote': {
    en: "Invite friends to the guestlist — everyone's on the door.",
    es: 'Invita a tus amigos a la lista — todos entran por la puerta.',
  },
  'rumbalist.splitFriends': { en: 'Split with friends', es: 'Divide con amigos' },
  'rumbalist.splitFriendsNote': {
    en: 'You cover the table by default; choose who chips in.',
    es: 'Tú cubres la mesa por defecto; elige quién pone su parte.',
  },

  // Apple Wallet
  'wallet.add': { en: 'Add to Apple Wallet', es: 'Añadir a Apple Wallet' },
  'wallet.error': { en: 'Could not load the pass', es: 'No se pudo cargar el pase' },

  // Venue detail (hardcoded EN on web)
  'detail.liveNow': { en: 'Live now', es: 'En vivo' },
  'detail.liveVibe': { en: 'Live Vibe', es: 'Ambiente en vivo' },
  'detail.capacity': { en: '%d%% capacity', es: '%d%% de aforo' },
  'detail.queue': { en: '~%d min queue', es: '~%d min de cola' },
  'detail.about': { en: 'About', es: 'Acerca de' },
  'detail.entry': { en: 'Entry', es: 'Entrada' },
  'detail.vipFrom': { en: 'VIP table from', es: 'Mesa VIP desde' },
  'detail.free': { en: 'Free', es: 'Gratis' },
  'detail.hours': { en: 'Hours', es: 'Horario' },
  'detail.openMaps': { en: 'Open in Maps', es: 'Abrir en Mapas' },
  'detail.notFound': { en: 'Club not found.', es: 'Club no encontrado.' },
  'detail.reviews': { en: '%d reviews', es: '%d reseñas' },
  'detail.door': { en: 'Door', es: 'Puerta' },
  'detail.reviewsLabel': { en: 'Reviews', es: 'Reseñas' },
  'detail.onGoogle': { en: 'on Google', es: 'en Google' },
  'detail.statusLabel': { en: 'Status', es: 'Estado' },
  'detail.ratingLabel': { en: 'Rating', es: 'Valoración' },
  'detail.open': { en: 'Open', es: 'Abierto' },
  'detail.closed': { en: 'Closed', es: 'Cerrado' },
  'detail.pitch': { en: 'The Pitch', es: 'La propuesta' },
  'detail.photos': { en: 'Photos', es: 'Fotos' },
  'detail.openingHours': { en: 'Opening Hours', es: 'Horario' },
  'detail.openNow': { en: 'Open now', es: 'Abierto ahora' },
  'detail.closedNow': { en: 'Closed now', es: 'Cerrado ahora' },
  'detail.seeHours': { en: 'See hours', es: 'Ver horario' },
  // Event cards on the venue page.
  'detail.whatsOn': { en: "What's on", es: 'Qué hay' },
  'detail.upcomingEvents': { en: 'Upcoming events', es: 'Próximos eventos' },
  'detail.presentedBy': { en: 'Presented by %@', es: 'Presentado por %@' },
  'detail.interestedCount': { en: '%d interested', es: '%d interesados' },
  'detail.ticketsOnRA': { en: 'Tickets on Resident Advisor', es: 'Entradas en Resident Advisor' },

  // Shelf titles/subtitles (hardcoded EN on web; native subset)
  'shelf.hero.title': { en: 'Tonight', es: 'Esta noche' },
  'shelf.hero.sub': { en: 'Free guestlists & VIP tables', es: 'Listas gratis y mesas VIP' },
  'shelf.top_rated.title': { en: 'Highest Rated', es: 'Mejor valorados' },
  'shelf.top_rated.sub': { en: 'The crowd has spoken', es: 'El público ha hablado' },
  'shelf.icons.title': { en: 'Barcelona Icons', es: 'Iconos de Barcelona' },
  'shelf.icons.sub': { en: 'Legendary — everyone knows them', es: 'Legendarios — todos los conocen' },
  'shelf.gems.title': { en: 'Hidden Gems', es: 'Joyas ocultas' },
  'shelf.gems.sub': { en: 'Under the radar, totally worth it', es: 'Fuera del radar, valen la pena' },
  'shelf.value.title': { en: 'Best Value', es: 'Mejor calidad-precio' },
  'shelf.value.sub': { en: 'Great night, small bill', es: 'Gran noche, cuenta pequeña' },
  'shelf.luxury.title': { en: 'Upscale & Exclusive', es: 'Exclusivos y elegantes' },
  'shelf.luxury.sub': { en: 'Dress to impress', es: 'Vístete para impresionar' },
  'shelf.partner.title': { en: 'Club Fuoco Partners', es: 'Socios de Club Fuoco' },
  'shelf.partner.sub': { en: 'Official partner venues', es: 'Locales socios oficiales' },
  'shelf.featured.title': { en: 'Featured Tonight', es: 'Destacados de esta noche' },
  'shelf.featured.sub': { en: 'Hand-picked for you', es: 'Escogidos a mano para ti' },
  'shelf.most_popular.title': { en: 'Most Popular Right Now', es: 'Los más populares ahora' },
  'shelf.most_popular.sub': { en: "Everyone's talking about these", es: 'Todos hablan de ellos' },
  'shelf.local_fav.title': { en: 'Local Favourites', es: 'Favoritos locales' },
  'shelf.local_fav.sub': { en: 'Where Barcelonians actually go', es: 'Donde van los barceloneses de verdad' },
  'shelf.clubs.title': { en: 'Clubs & Discos', es: 'Clubs y discotecas' },
  'shelf.clubs.sub': { en: 'Proper dancefloors all night', es: 'Pistas de baile toda la noche' },
  'shelf.bars.title': { en: 'Bars & Lounges', es: 'Bares y lounges' },
  'shelf.bars.sub': { en: 'Pre-drinks or the whole night', es: 'Para empezar o para toda la noche' },
  'shelf.cocktail.title': { en: 'Cocktail Bars', es: 'Coctelerías' },
  'shelf.cocktail.sub': { en: 'Craft drinks, serious bartenders', es: 'Cócteles de autor, bartenders serios' },
  'shelf.rooftop.title': { en: 'Rooftop Terraces', es: 'Terrazas en azoteas' },
  'shelf.rooftop.sub': { en: 'City lights from above', es: 'Las luces de la ciudad desde arriba' },
  'shelf.live_music.title': { en: 'Live Music Venues', es: 'Salas con música en directo' },
  'shelf.live_music.sub': { en: 'Real instruments, real feeling', es: 'Instrumentos reales, emoción real' },
  'shelf.techno.title': { en: 'Techno & Dark Rooms', es: 'Techno y salas oscuras' },
  'shelf.techno.sub': { en: 'Where the bass never stops', es: 'Donde el bajo nunca para' },
  'shelf.house.title': { en: 'House Music', es: 'Música house' },
  'shelf.house.sub': { en: 'For the 4/4 faithful', es: 'Para los fieles del 4/4' },
  'shelf.latin.title': { en: 'Latin Nights', es: 'Noches latinas' },
  'shelf.latin.sub': { en: 'Salsa, merengue, reggaeton', es: 'Salsa, merengue, reguetón' },
  'shelf.gothic.title': { en: 'Gothic Quarter', es: 'Barrio Gótico' },
  'shelf.gothic.sub': { en: 'Ancient streets, all-night energy', es: 'Calles antiguas, energía toda la noche' },
  'shelf.born.title': { en: 'El Born & Sant Pere', es: 'El Born y Sant Pere' },
  'shelf.born.sub': { en: 'Cool bars, cooler crowd', es: 'Bares con estilo, gente con más' },
  'shelf.eixample.title': { en: 'Eixample', es: 'Eixample' },
  'shelf.eixample.sub': { en: 'The Gayxample & beyond', es: 'El Gayxample y más allá' },
  'shelf.gracia.title': { en: 'Gràcia', es: 'Gràcia' },
  'shelf.gracia.sub': { en: 'Neighbourhood bars, big personality', es: 'Bares de barrio con personalidad' },
  'shelf.date_night.title': { en: 'Date Night', es: 'Noche de cita' },
  'shelf.date_night.sub': { en: 'Impress from the first drink', es: 'Impresiona desde la primera copa' },
  'shelf.pre_drinks.title': { en: 'Pre-Drinks Spots', es: 'Para los previos' },
  'shelf.pre_drinks.sub': { en: 'Start the night right', es: 'Empieza bien la noche' },
  'shelf.first_timer.title': { en: 'First Time in Barcelona?', es: '¿Primera vez en Barcelona?' },
  'shelf.first_timer.sub': { en: 'Start with these', es: 'Empieza por estos' },
}

const en = loadDict('en')
const es = loadDict('es')

const missing = Object.keys(en).filter((k) => !(k in es))
if (missing.length) {
  console.error(`es.ts is missing ${missing.length} keys: ${missing.slice(0, 5).join(', ')}…`)
}

const strings = {}
for (const key of Object.keys(en)) {
  strings[key] = {
    localizations: {
      en: { stringUnit: { state: 'translated', value: en[key] } },
      es: { stringUnit: { state: 'translated', value: es[key] ?? en[key] } },
    },
  }
}
for (const [key, vals] of Object.entries(NATIVE_KEYS)) {
  strings[key] = {
    localizations: {
      en: { stringUnit: { state: 'translated', value: vals.en } },
      es: { stringUnit: { state: 'translated', value: vals.es } },
    },
  }
}

const catalog = { sourceLanguage: 'en', version: '1.0', strings }
const outPath = path.join(__dirname, '..', 'ClubFuoco', 'Core', 'Localization', 'Localizable.xcstrings')
fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + '\n')
console.log(`Wrote ${Object.keys(strings).length} keys to ${outPath}`)
