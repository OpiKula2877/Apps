import { useCallback, useEffect, useState } from 'react'
import { generatePassword, type GeneratorOptions } from '../../../shared/passwords'
import { IconButton } from '../components/Icon'
import { Modal } from '../components/Modal'
import { StrengthMeter } from '../components/StrengthMeter'
import { useApp } from '../context'

const CHECKS: [keyof GeneratorOptions, string][] = [
  ['lower', 'generator.lower'],
  ['upper', 'generator.upper'],
  ['digits', 'generator.digits'],
  ['symbols', 'generator.symbols'],
  ['avoidAmbiguous', 'generator.ambiguous']
]

export function GeneratorDialog({ onUse, onClose }: { onUse: (password: string) => void; onClose: () => void }) {
  const { t } = useApp()
  const [options, setOptions] = useState<GeneratorOptions>({ length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false })
  const [password, setPassword] = useState('')
  const regenerate = useCallback(() => setPassword(generatePassword(options)), [options])
  useEffect(regenerate, [regenerate])
  const setLength = (value: number): void => setOptions((o) => ({ ...o, length: Math.min(64, Math.max(8, value || 8)) }))

  return (
    <Modal
      title={t('generator.title')}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" data-autofocus onClick={() => onUse(password)}>
            {t('generator.use')}
          </button>
        </>
      }
    >
      <div className="row">
        <input className="mono grow" readOnly value={password} aria-label={t('generator.title')} />
        <IconButton icon="refresh" label={t('generator.again')} onClick={regenerate} />
      </div>
      <StrengthMeter password={password} />
      <div className="row">
        <span>{t('generator.length')}</span>
        <input className="grow" type="range" min={8} max={64} value={options.length} onChange={(e) => setLength(Number(e.target.value))} />
        <input className="number" type="number" min={8} max={64} value={options.length} onChange={(e) => setLength(Number(e.target.value))} />
      </div>
      {CHECKS.map(([key, label]) => (
        <label key={key} className="check">
          <input type="checkbox" checked={Boolean(options[key])} onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))} />
          {t(label)}
        </label>
      ))}
    </Modal>
  )
}
