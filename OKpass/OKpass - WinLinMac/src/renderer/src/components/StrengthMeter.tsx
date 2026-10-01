import { strength } from '../../../shared/passwords'
import { useApp } from '../context'

export function StrengthMeter({ password }: { password: string }) {
  const { t } = useApp()
  const level = strength(password)
  return (
    <div className="strength">
      <div className={`strength-bar level-${level}`}>
        <div className="strength-fill" style={{ width: `${level * 25}%` }} />
      </div>
      <span className="muted strength-text">{t(`strength.${level}`)}</span>
    </div>
  )
}
