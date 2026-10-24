/** A rejected import file stays in its dialog, one problem per line, instead of fading in a toast (#157). */
export function ImportErrorAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {message}
    </div>
  )
}
