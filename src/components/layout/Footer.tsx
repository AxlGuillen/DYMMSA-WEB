import Link from 'next/link'

export function Footer() {
  return (
    <footer className="border-t py-4 text-center text-xs text-muted-foreground">
      <p>
        DYMMSA &copy; {new Date().getFullYear()} &mdash; Desarrollado por{' '}
        <a
          href="https://axl13.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Axl
        </a>
        {' | '}
        <Link
          href="/dashboard/docs"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Documentacion
        </Link>
      </p>
    </footer>
  )
}
