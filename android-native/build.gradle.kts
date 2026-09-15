// Root build file. Plugins are declared here (apply false) and applied in
// :app, the standard AGP layout.
// AGP 9 ships Kotlin support built in, so there is deliberately no
// `org.jetbrains.kotlin.android` plugin here — applying it is now a hard error
// (see kotl.in/gradle/agp-built-in-kotlin). Only the Compose and serialization
// compiler plugins are still separate.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.google.services) apply false
}
