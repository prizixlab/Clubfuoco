import type { Config } from 'tailwindcss'

// Barcelona Noir — extracted from DESIGN.md
const config: Config = {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Surfaces
        background:               '#121414',
        surface:                  '#121414',
        'surface-dim':            '#121414',
        'surface-bright':         '#38393a',
        'surface-container-lowest': '#0d0e0f',
        'surface-container-low':  '#1a1c1c',
        'surface-container':      '#1e2020',
        'surface-container-high': '#292a2a',
        'surface-container-highest': '#343535',
        'surface-variant':        '#343535',

        // Primary (ignite coral)
        primary:                  '#ffb4a6',
        'primary-container':      '#ff5539',
        'primary-fixed':          '#ffdad3',
        'primary-fixed-dim':      '#ffb4a6',
        'on-primary':             '#660800',
        'on-primary-container':   '#590600',
        'on-primary-fixed':       '#3f0300',
        'on-primary-fixed-variant': '#8f1000',
        'inverse-primary':        '#bb1900',
        'surface-tint':           '#ffb4a6',

        // Secondary
        secondary:                '#ffb4a5',
        'secondary-container':    '#901a05',
        'secondary-fixed':        '#ffdad3',
        'secondary-fixed-dim':    '#ffb4a5',
        'on-secondary':           '#650b00',
        'on-secondary-container': '#ff9f8c',
        'on-secondary-fixed':     '#3e0400',
        'on-secondary-fixed-variant': '#8c1703',

        // Tertiary (neutral greys)
        tertiary:                 '#c8c6c5',
        'tertiary-container':     '#929090',
        'tertiary-fixed':         '#e5e2e1',
        'tertiary-fixed-dim':     '#c8c6c5',
        'on-tertiary':            '#313030',
        'on-tertiary-container':  '#2a2a29',
        'on-tertiary-fixed':      '#1c1b1b',
        'on-tertiary-fixed-variant': '#474646',

        // Text
        'on-surface':             '#e3e2e2',
        'on-surface-variant':     '#e5beb6',
        'on-background':          '#e3e2e2',
        'inverse-surface':        '#e3e2e2',
        'inverse-on-surface':     '#2f3131',

        // Borders
        outline:                  '#ac8982',
        'outline-variant':        '#5c403a',

        // Error
        error:                    '#ffb4ab',
        'error-container':        '#93000a',
        'on-error':               '#690005',
        'on-error-container':     '#ffdad6',
      },
      fontFamily: {
        display: ['Inter', 'sans-serif'],
        h1:      ['Inter', 'sans-serif'],
        h2:      ['Inter', 'sans-serif'],
        'body-lg': ['Inter', 'sans-serif'],
        'body-md': ['Inter', 'sans-serif'],
        'label-sm': ['Inter', 'sans-serif'],
      },
      fontSize: {
        display:   ['48px', { lineHeight: '1.1',  letterSpacing: '-0.04em', fontWeight: '800' }],
        h1:        ['32px', { lineHeight: '1.2',  letterSpacing: '-0.02em', fontWeight: '700' }],
        h2:        ['24px', { lineHeight: '1.3',  letterSpacing: '-0.01em', fontWeight: '700' }],
        'body-lg': ['18px', { lineHeight: '1.6',  letterSpacing: '0',       fontWeight: '400' }],
        'body-md': ['16px', { lineHeight: '1.6',  letterSpacing: '0',       fontWeight: '400' }],
        'label-sm':['12px', { lineHeight: '1',    letterSpacing: '0.05em',  fontWeight: '600' }],
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        sm:  '0.25rem',
        md:  '0.75rem',
        lg:  '0.5rem',
        xl:  '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        full: '9999px',
      },
      spacing: {
        xs:   '4px',
        sm:   '12px',
        base: '8px',
        gutter: '16px',
        md:   '24px',
        lg:   '40px',
        xl:   '64px',
        'container-padding': '20px',
      },
    },
  },
  plugins: [],
}

export default config
