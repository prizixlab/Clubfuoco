package com.clubfuoco.app.core

import com.clubfuoco.app.R

/**
 * The drink vocabulary, shared by the onboarding survey and the morning-after
 * review. Mirrors `DRINK_CATEGORIES` in `src/lib/preferences.ts` and
 * `DrinkCategories.swift` — all three must be edited together.
 *
 * WHAT IS AND IS NOT TRANSLATED, and why it matters:
 *
 *  - [labelRes] is display only, so it is a string resource.
 *  - [key] and [items] are DATA. They are what gets written to the survey row
 *    and later aggregated across every user to work out which club pours the
 *    best Negroni. Translating them would split one drink into four, so they
 *    stay canonical English — and most of them (Negroni, Estrella Damm,
 *    Jägermeister) are proper nouns that are the same in every language anyway.
 */
data class DrinkCategory(
    val key: String,
    val labelRes: Int,
    val items: List<String>,
)

val DRINK_CATEGORIES: List<DrinkCategory> = listOf(
    DrinkCategory(
        "cocktails", R.string.drinks_cocktails,
        listOf(
            "Espresso Martini", "Aperol Spritz", "Mojito", "Negroni", "Margarita",
            "Gin & Tonic", "Long Island Iced Tea", "Daiquiri", "Cosmopolitan", "Paloma",
            "Old Fashioned", "Whiskey Sour", "Manhattan", "Dark & Stormy", "Moscow Mule",
            "Piña Colada", "Sex on the Beach", "Tequila Sunrise", "Blue Lagoon", "Sidecar",
            "Bramble", "French 75", "Kir Royale", "Bellini", "Mimosa",
            "Hugo", "Tom Collins", "Singapore Sling", "Caipirinha", "Pisco Sour",
            "Mai Tai", "White Russian", "Bloody Mary", "Cuba Libre", "Spicy Margarita",
            "Mezcal Negroni", "Jungle Bird", "Paper Plane", "Last Word", "Penicillin",
            "Clover Club", "Porn Star Martini", "Naked & Famous", "Gimlet", "Bee's Knees",
        ),
    ),
    DrinkCategory(
        "beer", R.string.drinks_beer,
        listOf(
            "Estrella Damm", "Moritz", "Voll-Damm", "San Miguel", "Corona",
            "Heineken", "Peroni", "Asahi", "Tiger", "Sapporo",
            "Modelo", "Dos Equis", "Guinness", "Newcastle Brown", "Blue Moon",
            "Craft IPA", "Hazy IPA", "Session IPA", "Pale Ale", "Amber Ale",
            "Wheat Beer", "Erdinger", "Paulaner", "Leffe", "Duvel",
            "Chimay", "Lager", "Pilsner", "Stout", "Porter", "Sour Beer",
        ),
    ),
    DrinkCategory(
        "wine", R.string.drinks_wine,
        listOf(
            "Red Wine", "White Wine", "Rosé", "Sangria", "Cava",
            "Prosecco", "Rioja", "Albariño",
        ),
    ),
    DrinkCategory(
        "shots", R.string.drinks_shots,
        listOf(
            "Tequila", "Mezcal", "Vodka", "Whiskey", "Jägermeister", "Sambuca",
            "Rum", "Gin", "Absinthe", "Fireball", "Limoncello", "Baileys",
        ),
    ),
    DrinkCategory(
        "champagne", R.string.drinks_champagne,
        listOf(
            "Moët & Chandon", "Veuve Clicquot", "Dom Pérignon", "Laurent-Perrier",
            "House Champagne", "Cava",
        ),
    ),
    DrinkCategory(
        "non_alcoholic", R.string.drinks_nonAlcoholic,
        listOf(
            "Mocktail", "Virgin Mojito", "Juice", "Sparkling Water", "Energy Drink",
            "Soda", "Kombucha", "Lemonade",
        ),
    ),
    // No preset items: this one exists precisely for what the list missed.
    DrinkCategory("other", R.string.drinks_other, emptyList()),
)

/**
 * Music genres offered on the review and onboarding surveys.
 *
 * Stored verbatim on the survey row like the drink items, so likewise canonical
 * English rather than translated.
 */
val MUSIC_GENRES: List<String> = listOf(
    "House", "Techno", "Hip-Hop", "R&B", "Latin", "Reggaeton", "Afrobeats",
    "Electronic", "Drum & Bass", "Commercial", "Live Music", "Jazz",
)
