# R8 rules for the release build.
#
# The release build shrinks, optimises and obfuscates. Most of what we depend on
# ships its own consumer rules inside its AAR — Compose, OkHttp, Coil, Ktor,
# Firebase, Play Services and kotlinx.serialization all do — so this file only
# covers the things NOTHING can infer: code reached from outside the Kotlin call
# graph, where R8 is right to think it is unused and wrong to remove it.
#
# Everything here is either load-bearing or a warning suppression. Do not add
# blanket `-keep class com.clubfuoco.**` — that would disable shrinking for the
# whole app and hide exactly the bugs this file exists to prevent.

# ── Reached from JavaScript, not from Kotlin ─────────────────────────────────
# DjPlayer's bridge is called BY the SoundCloud widget page over
# addJavascriptInterface. Nothing in our own code calls onEvent, so R8 removes
# it and the player silently never leaves the loading state — no crash, no log,
# just a dead play button. This is the single most important rule in the file.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── kotlinx.serialization ────────────────────────────────────────────────────
# The plugin generates a `Companion` and a `$$serializer` alongside every
# @Serializable class. Our call sites pass serializers explicitly
# (`Booking.serializer()`), which R8 can follow — but Ktor and the Supabase
# client resolve some of them reflectively through `serializer<T>()`, which it
# cannot. Keeping the generated members costs a few kilobytes and removes a
# whole class of "works in debug, throws SerializationException in release".
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1>$Companion {
    kotlinx.serialization.KSerializer serializer(...);
}

# Enum constants named in JSON are matched by name, and obfuscating the names
# breaks that silently for anything using the default enum serializer.
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── Our API models ───────────────────────────────────────────────────────────
# The @SerialName strings ARE the wire contract with the backend. Property names
# can be obfuscated freely (the generated serializer holds the wire names), but
# the classes themselves must survive as a unit with their serializers.
-keep @kotlinx.serialization.Serializable class com.clubfuoco.app.** { *; }

# ── Ktor engine selection ────────────────────────────────────────────────────
# Ktor finds its HTTP engine through a ServiceLoader entry, so the OkHttp engine
# has no incoming reference R8 can see.
-keep class io.ktor.client.engine.okhttp.** { *; }
-dontwarn io.ktor.**
-dontwarn org.slf4j.**

# ── TLS providers OkHttp probes for and we do not ship ───────────────────────
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ── Google Sign-In through Credential Manager ────────────────────────────────
# The credential types are constructed reflectively from a Bundle the Play
# Services process hands back, so their constructors have no caller here.
-keep class com.google.android.libraries.identity.googleid.** { *; }
-keep class androidx.credentials.playservices.** { *; }

# ── Play Install Referrer ────────────────────────────────────────────────────
# AIDL stubs, bound across a process boundary by name.
-keep class com.android.installreferrer.** { *; }

# ── Desugaring ───────────────────────────────────────────────────────────────
# The date math runs on desugared java.time down to API 26.
-dontwarn java.lang.invoke.**
-dontwarn build.IgnoreJava8API

# Keep the line numbers in a crash report meaningful, while still obfuscating.
# Without SourceFile the stack traces Play shows are unreadable; the mapping
# file is what turns them back into our names, so upload it with every release.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Annotations the serialization and Compose runtimes read at runtime.
-keepattributes *Annotation*,InnerClasses,Signature,RuntimeVisible*Annotations
