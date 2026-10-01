import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { useApp } from '../context'
import { Icon } from './Icon'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/** Masked input with an eye button that shows or hides the text. */
export const SecretInput = forwardRef<HTMLInputElement, Props>(function SecretInput({ className = '', ...rest }, ref) {
  const { t } = useApp()
  const [visible, setVisible] = useState(false)
  return (
    <div className={`secret-input ${className}`}>
      <input ref={ref} type={visible ? 'text' : 'password'} spellCheck={false} autoComplete="off" {...rest} />
      <button
        type="button"
        className="secret-eye"
        title={t('common.show_hide')}
        aria-label={t('common.show_hide')}
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
      >
        <Icon name={visible ? 'eye_off' : 'eye'} size={16} />
      </button>
    </div>
  )
})
