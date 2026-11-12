interface ErrorBannerProps {
  message: string
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200">
      {message}
    </div>
  )
}
