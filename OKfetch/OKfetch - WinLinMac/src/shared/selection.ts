// Rules for deleting several messages at once.
import type { MessageView } from './model'

/** "Delete for both" only works on my own messages: one foreign message in the selection turns it off. */
export function canDeleteForBoth(selected: Pick<MessageView, 'mine'>[]): boolean {
  return selected.length > 0 && selected.every((message) => message.mine)
}
