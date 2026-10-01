import { STRINGS } from './strings'

export type Language = 'cs' | 'en'
export type Translate = (key: string, params?: Record<string, string | number>) => string

export function translator(language: Language): Translate {
  return (key, params) => {
    const entry = STRINGS[key]
    if (!entry) return key
    const text = entry[language] || entry.cs
    return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text
  }
}
