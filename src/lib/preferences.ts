// ── Shared preference constants ───────────────────────────────────────────────
// Single source of truth for onboarding + settings.
// Import from here — never duplicate these lists.

export const DRINK_CATEGORIES = [
  {
    key: 'cocktails',
    label: 'Cocktails',
    allowCustom: true,
    items: [
      'Espresso Martini', 'Aperol Spritz', 'Mojito', 'Negroni', 'Margarita',
      'Gin & Tonic', 'Long Island Iced Tea', 'Daiquiri', 'Cosmopolitan', 'Paloma',
      'Old Fashioned', 'Whiskey Sour', 'Manhattan', 'Dark & Stormy', 'Moscow Mule',
      'Piña Colada', 'Sex on the Beach', 'Tequila Sunrise', 'Blue Lagoon', 'Sidecar',
      'Bramble', 'French 75', 'Kir Royale', 'Bellini', 'Mimosa',
      'Hugo', 'Tom Collins', 'Singapore Sling', 'Caipirinha', 'Pisco Sour',
      'Mai Tai', 'White Russian', 'Bloody Mary', 'Cuba Libre', 'Spicy Margarita',
      'Mezcal Negroni', 'Jungle Bird', 'Paper Plane', 'Last Word', 'Penicillin',
      'Clover Club', 'Porn Star Martini', 'Naked & Famous', 'Gimlet', "Bee's Knees",
    ],
  },
  {
    key: 'beer',
    label: 'Beer',
    allowCustom: true,
    items: [
      'Estrella Damm', 'Moritz', 'Voll-Damm', 'San Miguel', 'Corona',
      'Heineken', 'Peroni', 'Asahi', 'Tiger', 'Sapporo',
      'Modelo', 'Dos Equis', 'Guinness', 'Newcastle Brown', 'Blue Moon',
      'Craft IPA', 'Hazy IPA', 'Session IPA', 'Pale Ale', 'Amber Ale',
      'Wheat Beer', 'Erdinger', 'Paulaner', 'Leffe', 'Duvel',
      'Chimay', 'Lager', 'Pilsner', 'Stout', 'Porter', 'Sour Beer',
    ],
  },
  {
    key: 'wine',
    label: 'Wine',
    allowCustom: true,
    items: ['Red Wine', 'White Wine', 'Rosé', 'Sangria', 'Cava', 'Prosecco', 'Rioja', 'Albariño'],
  },
  {
    key: 'shots',
    label: 'Shots',
    allowCustom: true,
    items: ['Tequila', 'Mezcal', 'Vodka', 'Whiskey', 'Jägermeister', 'Sambuca', 'Rum', 'Gin', 'Absinthe', 'Fireball', 'Limoncello', 'Baileys'],
  },
  {
    key: 'champagne',
    label: 'Champagne',
    allowCustom: true,
    items: ['Moët & Chandon', 'Veuve Clicquot', 'Dom Pérignon', 'Laurent-Perrier', 'House Champagne', 'Cava'],
  },
  {
    key: 'non_alcoholic',
    label: 'Non-alcoholic',
    allowCustom: true,
    items: ['Mocktail', 'Virgin Mojito', 'Juice', 'Sparkling Water', 'Energy Drink', 'Soda', 'Kombucha', 'Lemonade'],
  },
  {
    key: 'other',
    label: 'Other',
    allowCustom: true,
    items: [],
  },
]

export const MUSIC_OPTIONS = [
  'Techno', 'House', 'Reggaeton', 'Hip-Hop', 'R&B', 'Latin',
  'Commercial', 'EDM', 'Drum & Bass', 'Disco', 'Funk', 'Afrobeats',
]

export const VIBE_OPTIONS = [
  'Dancing', 'Socialising', 'Chilling', 'VIP',
  'Rooftop', 'Underground', 'Live Music', 'Date Night',
]

export const BUDGET_NO_LIMIT = 999
