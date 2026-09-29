package com.clubfuoco.app.core

/**
 * Canonical URLs for the public legal pages. Kept in one place so every in-app
 * link points at the same hosted document — port of `LegalURLs.swift`.
 *
 * Note these use the BRAND domain, while the API client talks to the Vercel
 * deployment host. The iOS app has one stray link that hardcodes the vercel.app
 * host and bypasses this file; do not repeat that here.
 */
object LegalUrls {
    const val TERMS = "https://clubfuoco.com/legal/terms"
    const val PRIVACY = "https://clubfuoco.com/legal/privacy"
    const val HELP = "https://clubfuoco.com/legal/help"
}
