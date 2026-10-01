import { useState } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { useData } from '../data'
import { RejectFeedbackDialog } from '../dialogs/RejectFeedbackDialog'
import { shortId } from '../util/format'

/** Collapsible "Requests (n)" panel: incoming requests, group invitations and my own pending requests. */
export function RequestsPanel() {
  const { t, confirm } = useApp()
  const { requests, pendingCount } = useData()
  const [open, setOpen] = useState(true)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const total = requests.incoming.length + requests.invites.length + requests.outgoing.length
  if (total === 0) return null

  const block = async (pub: string, name: string): Promise<void> => {
    const ok = await confirm({ title: t('request.block'), text: t('request.block_text', { name }), confirmText: t('request.block'), danger: true })
    if (ok) void api.blockPeer(pub, name)
  }

  return (
    <div className="requests">
      <button type="button" className="requests-head" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevron_down' : 'chevron_right'} size={14} />
        <Icon name="inbox" size={15} />
        <span className="grow">{t('requests.title', { n: pendingCount })}</span>
      </button>
      {open && (
        <div className="requests-body">
          {requests.incoming.map((request) => (
            <div key={request.pub} className="request-card">
              <div className="item-title">{request.username}</div>
              <div className="item-sub muted" title={request.pub}>{shortId(request.pub)}</div>
              <div className="request-actions">
                <button type="button" className="primary" onClick={() => void api.acceptRequest(request.pub)}>
                  {t('request.accept')}
                </button>
                <button type="button" onClick={() => setRejecting(request.pub)}>
                  {t('request.reject')}
                </button>
                <button type="button" className="danger-outline" onClick={() => void block(request.pub, request.username)}>
                  {t('request.block')}
                </button>
              </div>
            </div>
          ))}
          {requests.invites.map((invite) => (
            <div key={invite.id} className="request-card">
              <div className="item-title">
                <Icon name="users" size={14} /> {invite.name}
              </div>
              <div className="item-sub muted">{t('group.invite_from', { name: invite.inviterName ?? '?', type: t(invite.type === 'enc' ? 'group.type_enc' : 'group.type_plain') })}</div>
              <div className="request-actions">
                <button type="button" className="primary" onClick={() => void api.acceptInvite(invite.id)}>
                  {t('request.accept')}
                </button>
                <button type="button" onClick={() => void api.declineInvite(invite.id)}>
                  {t('request.reject')}
                </button>
              </div>
            </div>
          ))}
          {requests.outgoing.map((request) => (
            <div key={request.pub} className="request-card outgoing">
              <div className="item-title">{request.name || shortId(request.pub)}</div>
              <div className={`item-sub ${request.state === 'rejected' ? 'error-text' : 'muted'}`}>
                {request.state === 'rejected'
                  ? t(`request.result.${request.reason ?? 'declined'}`, { min: request.retryMin ?? 15 })
                  : t(request.state === 'sent' ? 'request.sent' : 'request.waiting')}
                {request.feedback && <div className="file-feedback">„{request.feedback}“</div>}
              </div>
              <div className="request-actions">
                <button type="button" onClick={() => void api.cancelRequest(request.pub)}>
                  {t(request.state === 'rejected' ? 'request.dismiss' : 'request.cancel')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {rejecting && (
        <RejectFeedbackDialog
          title={t('request.reject')}
          info={t('request.reject_info')}
          confirmText={t('request.reject')}
          onClose={() => setRejecting(null)}
          onConfirm={(feedback) => {
            void api.rejectRequest(rejecting, feedback)
            setRejecting(null)
          }}
        />
      )}
    </div>
  )
}
