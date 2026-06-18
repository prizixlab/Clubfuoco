import Foundation

/// Single source of truth for the drink picker categories used in both the
/// onboarding survey (`SurveyView`) and the morning-after review sheet
/// (`ReviewSurveySheet`). Mirrors `DRINK_CATEGORIES` in
/// `src/lib/preferences.ts` on the web — edit there + here together.
struct DrinkCategory: Sendable, Hashable {
    let key: String
    let label: String
    let items: [String]
}

let DRINK_CATEGORIES: [DrinkCategory] = [
    .init(key: "cocktails", label: "Cocktails", items: [
        "Espresso Martini","Aperol Spritz","Mojito","Negroni","Margarita",
        "Gin & Tonic","Long Island Iced Tea","Daiquiri","Cosmopolitan","Paloma",
        "Old Fashioned","Whiskey Sour","Manhattan","Dark & Stormy","Moscow Mule",
        "Piña Colada","Sex on the Beach","Tequila Sunrise","Blue Lagoon","Sidecar",
        "Bramble","French 75","Kir Royale","Bellini","Mimosa",
        "Hugo","Tom Collins","Singapore Sling","Caipirinha","Pisco Sour",
        "Mai Tai","White Russian","Bloody Mary","Cuba Libre","Spicy Margarita",
        "Mezcal Negroni","Jungle Bird","Paper Plane","Last Word","Penicillin",
        "Clover Club","Porn Star Martini","Naked & Famous","Gimlet","Bee's Knees",
    ]),
    .init(key: "beer", label: "Beer", items: [
        "Estrella Damm","Moritz","Voll-Damm","San Miguel","Corona",
        "Heineken","Peroni","Asahi","Tiger","Sapporo",
        "Modelo","Dos Equis","Guinness","Newcastle Brown","Blue Moon",
        "Craft IPA","Hazy IPA","Session IPA","Pale Ale","Amber Ale",
        "Wheat Beer","Erdinger","Paulaner","Leffe","Duvel",
        "Chimay","Lager","Pilsner","Stout","Porter","Sour Beer",
    ]),
    .init(key: "wine", label: "Wine", items: [
        "Red Wine","White Wine","Rosé","Sangria","Cava","Prosecco","Rioja","Albariño",
    ]),
    .init(key: "shots", label: "Shots", items: [
        "Tequila","Mezcal","Vodka","Whiskey","Jägermeister","Sambuca",
        "Rum","Gin","Absinthe","Fireball","Limoncello","Baileys",
    ]),
    .init(key: "champagne", label: "Champagne", items: [
        "Moët & Chandon","Veuve Clicquot","Dom Pérignon","Laurent-Perrier",
        "House Champagne","Cava",
    ]),
    .init(key: "non_alcoholic", label: "Non-alcoholic", items: [
        "Mocktail","Virgin Mojito","Juice","Sparkling Water","Energy Drink",
        "Soda","Kombucha","Lemonade",
    ]),
    .init(key: "other", label: "Other", items: []),
]
