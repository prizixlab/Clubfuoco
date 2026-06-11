'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { en, type MessageKey } from '@/messages/en'
import { es } from '@/messages/es'

export type Locale = 'en' | 'es'
export type LocaleSetting = Locale | 'device'

const STORAGE_KEY = 'cf-locale'
const DICTS: Record<Locale, Record<string, string>> = { en: en as Record<string, string>, es: es as Record<string, string> }

function detectDeviceLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en'
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language ?? 'en']
  for (const lang of langs) {
    if (lang.startsWith('es')) return 'es'
  }
  return 'en'
}

// Reads stored preference synchronously so the very first render uses the right
// language — avoids a flash of English on Spanish-language devices.
function resolveInitial(): { setting: LocaleSetting; locale: Locale } {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as LocaleSetting | null
    if (v === 'en' || v === 'es') return { setting: v, locale: v }
    // 'device' or nothing stored — auto-detect
    const device = detectDeviceLocale()
    return { setting: 'device', locale: device }
  } catch {
    // SSR context — default to English; useEffect will correct on hydration
    return { setting: 'device', locale: 'en' }
  }
}

interface LocaleContextValue {
  locale: Locale
  setting: LocaleSetting
  setLocaleSetting: (s: LocaleSetting) => void
  t: (key: MessageKey) => string
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  setting: 'device',
  setLocaleSetting: () => {},
  t: (k) => en[k] as string,
})

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [setting, setSetting] = useState<LocaleSetting>(() => resolveInitial().setting)
  const [locale,  setLocale]  = useState<Locale>(() => resolveInitial().locale)

  function setLocaleSetting(s: LocaleSetting) {
    setSetting(s)
    try { localStorage.setItem(STORAGE_KEY, s) } catch { /* ignore */ }
    setLocale(s === 'device' ? detectDeviceLocale() : s)
  }

  function t(key: MessageKey): string {
    return (DICTS[locale][key] ?? (en as Record<string, string>)[key] ?? key) as string
  }

  return (
    <LocaleContext.Provider value={{ locale, setting, setLocaleSetting, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}
