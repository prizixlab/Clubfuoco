const ADJECTIVES = [
  'electric', 'golden', 'endless', 'wild', 'midnight', 'neon', 'velvet',
  'burning', 'fearless', 'blazing', 'vibrant', 'fierce', 'relentless',
  'infinite', 'radiant', 'hypnotic', 'unstoppable', 'luminous', 'raw',
]

const NOUNS = [
  'night', 'beat', 'crowd', 'rhythm', 'wave', 'pulse', 'fire',
  'energy', 'vibe', 'music', 'lights', 'floor', 'bass', 'sound', 'moment',
]

const VERB_PHRASES = [
  'never stops', 'never sleeps', 'keeps going', 'goes on forever',
  'never fades', 'always drops', 'never ends', 'burns bright',
  'moves the crowd', 'takes over', 'hits different', 'lives on',
]

const TEMPLATES = [
  (adj: string, noun: string, verb: string) =>
    `The party never stops where the ${adj} beats ${verb}`,
  (adj: string, noun: string, verb: string) =>
    `Where the ${adj} ${noun} ${verb}, the night goes on`,
  (adj: string, noun: string, verb: string) =>
    `The ${noun} ${verb} and the crowd never leaves`,
  (adj: string, noun: string, verb: string) =>
    `Let the ${adj} ${noun} move you — the music ${verb}`,
  (adj: string, noun: string, verb: string) =>
    `When the ${adj} ${noun} ${verb}, every night feels right`,
  (adj: string, noun: string, verb: string) =>
    `The ${adj} ${noun} ${verb} — and so do we`,
  (adj: string, noun: string, verb: string) =>
    `Feel the ${adj} ${noun} — it ${verb}`,
  (adj: string, noun: string, verb: string) =>
    `The ${noun} ${verb} where the ${adj} lights shine`,
  (adj: string, noun: string, verb: string) =>
    `Born from the ${adj} ${noun} that ${verb}`,
  (adj: string, noun: string, verb: string) =>
    `The ${adj} ${noun} ${verb} — welcome to the night`,
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generateVerificationPhrase(): string {
  const template = pick(TEMPLATES)
  return template(pick(ADJECTIVES), pick(NOUNS), pick(VERB_PHRASES))
}
