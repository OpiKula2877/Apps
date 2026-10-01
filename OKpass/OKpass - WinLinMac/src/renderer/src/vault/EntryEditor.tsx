import { Fragment, useEffect, useRef, useState } from 'react'
import { entryTitle, newField, nowSeconds, setFieldName, type Field, type FieldKind, type PasswordEntry } from '../../../shared/model'
import { api } from '../api'
import { Icon, IconButton } from '../components/Icon'
import { SecretInput } from '../components/SecretInput'
import { StrengthMeter } from '../components/StrengthMeter'
import { useApp } from '../context'
import { GeneratorDialog } from './GeneratorDialog'
import { formatTime } from './TextTab'

const DEFAULT_LABELS: Record<Exclude<FieldKind, 'custom'>, string> = {
  title: 'entry.field.title',
  username: 'entry.field.username',
  password: 'entry.field.password'
}

interface Props {
  entry: PasswordEntry
  onChange: (entry: PasswordEntry) => void
  onDelete: () => void
  focusTitle: boolean
  /** Phone: back to the list. */
  onBack?: () => void
}

export function EntryEditor({ entry, onChange, onDelete, focusTitle, onBack }: Props) {
  const { t, confirm, notify } = useApp()
  const [generatorFor, setGeneratorFor] = useState<string | null>(null)
  const [focusField, setFocusField] = useState<string | null>(null)
  const titleValue = useRef<HTMLInputElement>(null)
  const nameInputs = useRef(new Map<string, HTMLInputElement>())

  useEffect(() => {
    if (focusTitle) titleValue.current?.focus()
  }, [focusTitle, entry.id])

  useEffect(() => {
    if (focusField) {
      nameInputs.current.get(focusField)?.focus()
      setFocusField(null)
    }
  }, [focusField])

  const save = (fields: Field[]): void => onChange({ ...entry, fields, modified: nowSeconds() })
  const updateField = (id: string, change: (f: Field) => Field): void => save(entry.fields.map((f) => (f.id === id ? change(f) : f)))

  const labelFor = (field: Field): string => (field.kind === 'custom' ? t('entry.field_name') : t(DEFAULT_LABELS[field.kind]))

  const copy = (field: Field): void => {
    void api.copyText(field.value)
    notify(t('entry.copied'))
  }

  const openGenerator = async (field: Field): Promise<void> => {
    if (field.value) {
      const ok = await confirm({ title: t('entry.generate'), text: t('entry.replace_password'), confirmText: t('entry.replace') })
      if (!ok) return
    }
    setGeneratorFor(field.id)
  }

  const removeField = async (field: Field): Promise<void> => {
    if (field.value) {
      const ok = await confirm({
        title: t('entry.remove_field'),
        text: t('entry.remove_field_confirm', { name: field.name || labelFor(field) }),
        confirmText: t('common.delete'),
        danger: true
      })
      if (!ok) return
    }
    save(entry.fields.filter((f) => f.id !== field.id))
  }

  const addField = (): void => {
    const field = newField('custom', '')
    save([...entry.fields, field])
    setFocusField(field.id)
  }

  return (
    <div className="entry-editor">
      <div className="entry-header">
        {onBack && <IconButton icon="back" label={t('common.back')} className="back-button" onClick={onBack} />}
        <h1 className="heading">{entryTitle(entry).trim() || t('entry.untitled')}</h1>
        <button type="button" className="danger-outline" onClick={onDelete} aria-label={t('entry.delete')}>
          <Icon name="trash" size={16} /> <span className="label-text">{t('entry.delete')}</span>
        </button>
      </div>
      <div className="field-grid">
        {entry.fields.map((field) => (
          <Fragment key={field.id}>
            <input
              ref={(el) => {
                if (el) nameInputs.current.set(field.id, el)
                else nameInputs.current.delete(field.id)
              }}
              className="field-name"
              value={field.name ?? ''}
              placeholder={labelFor(field)}
              title={t('entry.label_hint')}
              aria-label={labelFor(field)}
              onChange={(e) => updateField(field.id, (f) => setFieldName(f, e.target.value))}
            />
            {field.kind === 'password' ? (
              <SecretInput
                value={field.value}
                placeholder={t('entry.placeholder.password')}
                aria-label={field.name || labelFor(field)}
                onChange={(e) => updateField(field.id, (f) => ({ ...f, value: e.target.value }))}
              />
            ) : (
              <input
                ref={field.kind === 'title' ? titleValue : undefined}
                value={field.value}
                spellCheck={false}
                placeholder={t(`entry.placeholder.${field.kind}`)}
                aria-label={field.name || labelFor(field)}
                onChange={(e) => updateField(field.id, (f) => ({ ...f, value: e.target.value }))}
              />
            )}
            <div className="field-buttons">
              {field.kind === 'password' && <IconButton icon="dice" label={t('entry.generate')} onClick={() => openGenerator(field)} />}
              <IconButton icon="copy" label={t('entry.copy')} onClick={() => copy(field)} />
              {field.kind === 'custom' && <IconButton icon="close" label={t('entry.remove_field')} tone="danger" onClick={() => removeField(field)} />}
            </div>
            {field.kind === 'password' && (
              <div className="field-meter">
                <StrengthMeter password={field.value} />
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <div>
        <button type="button" onClick={addField}>
          <Icon name="plus" size={16} /> {t('entry.add_field')}
        </button>
      </div>
      <div className="muted meta">{t('common.created_modified', { created: formatTime(entry.created), modified: formatTime(entry.modified) })}</div>
      {generatorFor && (
        <GeneratorDialog
          onClose={() => setGeneratorFor(null)}
          onUse={(password) => {
            updateField(generatorFor, (f) => ({ ...f, value: password }))
            setGeneratorFor(null)
          }}
        />
      )}
    </div>
  )
}
