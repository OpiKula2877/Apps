// Folder and file names derived from untrusted input. Free of Node-only imports so the phone can use it too.

/** Folder-safe form of a chat id (':' is not allowed in Windows paths). */
export const chatDirName = (chatId: string): string => chatId.replace(/[^A-Za-z0-9_-]/g, '_')

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim().slice(0, 120)
  return cleaned || 'file'
}
