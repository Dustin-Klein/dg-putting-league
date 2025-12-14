'use client'

import { useRef, useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { 
  Toast, 
  ToastProvider, 
  ToastViewport, 
  ToastTitle, 
  ToastDescription, 
  ToastClose 
} from '@/components/ui/toast'

export function Toaster() {
  type ToastType = {
    id: string
    title: string
    description?: string
    variant?: 'default' | 'destructive'
  }

  const [toasts, setToasts] = useState<ToastType[]>([])
  const { theme } = useTheme()
  const toast = useToaster()
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }

    const handleToast = (event: CustomEvent) => {
      const { title, description, variant } = event.detail
      setToasts((currentToasts) => [
        ...currentToasts,
        {
          id: Math.random().toString(36).substring(2, 9),
          title,
          description,
          variant,
        },
      ])
    }

    window.addEventListener('toast', handleToast as EventListener)
    return () => {
      window.removeEventListener('toast', handleToast as EventListener)
    }
  }, [])

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, variant }) => (
        <Toast
          key={id}
          variant={variant}
          onOpenChange={(open) => {
            if (!open) {
              setToasts((currentToasts) =>
                currentToasts.filter((toast) => toast.id !== id)
              )
            }
          }}
        >
          <div className="grid gap-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && (
              <ToastDescription>{description}</ToastDescription>
            )}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}

export function useToaster() {
  const toast = ({
    title,
    description,
    variant = 'default',
  }: {
    title: string
    description?: string
    variant?: 'default' | 'destructive'
  }) => {
    const event = new CustomEvent('toast', {
      detail: { title, description, variant },
    })
    window.dispatchEvent(event)
  }

  return toast
}
