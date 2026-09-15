package com.clubfuoco.app.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Account type drives which tab set the app shows. Unknown values fall back to
 * `user`, matching AuthContext on web and `AccountType` on iOS.
 */
enum class AccountType {
    USER, CLUB, DJ;

    companion object {
        fun from(raw: String?): AccountType =
            entries.firstOrNull { it.name.equals(raw, ignoreCase = true) } ?: USER
    }
}

/**
 * Self-declared gender, required at signup. Drives guest-list payout settlement
 * (clubs pay promoters different per-head rates by gender); `prefer_not_to_say`
 * settles at the higher rate as the legal default.
 */
enum class Gender(val raw: String) {
    MALE("male"),
    FEMALE("female"),
    PREFER_NOT_TO_SAY("prefer_not_to_say");

    /** Key into the string catalog: `signup.gender.<raw>` → `signup_gender_<raw>`. */
    val stringKey: String get() = "signup_gender_$raw"

    companion object {
        fun from(raw: String?): Gender? = entries.firstOrNull { it.raw == raw }
    }
}

/**
 * Row from `public.users`. Only the fields the app reads are modelled; the
 * serializer ignores the rest.
 *
 * Dates stay String: Postgres date columns arrive as "YYYY-MM-DD" and
 * timestamps as ISO 8601 with variable precision, so parsing them eagerly buys
 * nothing and loses fidelity.
 */
@Serializable
data class UserProfile(
    val id: String,
    val email: String? = null,
    @SerialName("full_name") val fullName: String? = null,
    val phone: String? = null,
    val birthday: String? = null,
    val gender: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    @SerialName("account_type") val accountType: String? = null,
    /** 'user' | 'promoter' — promoters cannot use the consumer app. */
    @SerialName("account_kind") val accountKind: String? = null,
    val role: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
) {
    val resolvedAccountType: AccountType get() = AccountType.from(accountType)

    /**
     * The same completeness rule `routeAfterOAuth()` applies before letting the
     * user past complete-profile.
     *
     * Gender was added 2026-06-22 for guest-list payout settlement, so existing
     * rows without one re-enter complete-profile on next launch. Phone is
     * deliberately OPTIONAL (2026-07-05) — gating on it bounced phone-less users
     * into complete-profile on every single launch.
     */
    val isComplete: Boolean
        get() = !fullName.isNullOrEmpty() &&
            !email.isNullOrEmpty() &&
            !birthday.isNullOrEmpty() &&
            !gender.isNullOrEmpty()
}
