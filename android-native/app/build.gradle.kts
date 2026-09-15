plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Firebase Cloud Messaging needs app/google-services.json, which comes from a
// Firebase project that does not exist yet. Applying the plugin without it is a
// hard build failure, so it is applied only once the file lands — that keeps the
// whole app buildable today and lights up push the moment the file is dropped
// in. See docs/TESTING.md.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

android {
    namespace = "com.clubfuoco.app"
    // 37 is forced by the current AndroidX libraries (navigation-compose and
    // Coil both refuse to link against anything older). compileSdk only decides
    // which APIs are visible, so it can run ahead of targetSdk safely.
    compileSdk = 37

    defaultConfig {
        // Same identifier as the iOS bundle id. Play and the App Store keep
        // separate namespaces, so matching them costs nothing and keeps the
        // backend's per-app rows (device_tokens.app) legible.
        applicationId = "com.clubfuoco.app"
        // 26 buys adaptive icons and a modern notification model. Anything
        // older is well under a percent of active devices and would cost real
        // workarounds in the geofencing and notification code.
        minSdk = 26
        // targetSdk opts into runtime behaviour changes, so it deliberately
        // trails compileSdk by one: 36 is well-understood, and moving to 37 is
        // a decision to make with a device in hand.
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        // The Android version train is INDEPENDENT of the App Store's 1.1x
        // numbering (see project-clubfuoco-release). Play only requires
        // versionCode to increase; it starts at 1 here and owes the iOS
        // numbering nothing.

        vectorDrawables.useSupportLibrary = true
    }

    androidResources {
        // Only the languages the string catalog actually carries — keeps
        // resource lookup honest and the APK smaller. (`resourceConfigurations`
        // is gone in AGP 9; localeFilters is its replacement.)
        localeFilters += listOf("en", "es", "ca", "fr")
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // No signingConfig yet — a release keystore has to be created and
            // kept out of the repo. Until then `assembleRelease` produces an
            // unsigned APK. See docs/TESTING.md.
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // java.time on API 26 has gaps the date math relies on; desugaring
        // gives the full library down to minSdk.
        isCoreLibraryDesugaringEnabled = true
    }

    // AGP 9's built-in Kotlin takes its JVM target from compileOptions above,
    // so there is no `kotlinOptions` block (it no longer exists).

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf(
            "/META-INF/{AL2.0,LGPL2.1}",
            "/META-INF/DEPENDENCIES",
        )
    }
}

dependencies {
    implementation(libs.core.ktx)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.activity.compose)

    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.navigation.compose)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.datastore.preferences)

    // Supabase: auth (session in EncryptedSharedPreferences, auto-refresh) plus
    // the direct PostgREST path — the same two-path architecture as iOS.
    implementation(platform(libs.supabase.bom))
    implementation(libs.supabase.auth)
    implementation(libs.supabase.postgrest)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.json)
    implementation(libs.kotlinx.serialization.json)

    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    // Google Sign-In via Credential Manager, geofencing, Google Pay.
    implementation(libs.credentials)
    implementation(libs.credentials.play.services)
    implementation(libs.googleid)
    implementation(libs.play.services.location)
    implementation(libs.play.services.wallet)
    implementation(libs.accompanist.permissions)

    // Deferred invite links — the Android answer to a problem iOS has to solve
    // with a clipboard read and a guess.
    implementation(libs.install.referrer)

    // Push. Harmless without google-services.json — the plugin above simply
    // isn't applied, and PushRegistrar no-ops.
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    implementation(libs.stripe.android)
    implementation(libs.zxing.core)

    // SoundCloud preview playback on the DJ page.
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)

    coreLibraryDesugaring(libs.desugar.jdk.libs)

    // Parity tests run on the JVM — the logic they cover is deliberately free of
    // Android dependencies so it can be verified without a device.
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.serialization.json)
}
