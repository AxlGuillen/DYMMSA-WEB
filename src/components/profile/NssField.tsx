'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff } from '@/components/icons'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { maskNss } from '@/lib/nss'

interface NssFieldProps {
  id: string
  label: string
  /** The stored NSS; while set, the field stays masked until revealed. */
  saved: string | null
  value: string
  onChange: (value: string) => void
  error?: string | null
}

export function NssField({ id, label, saved, value, onChange, error }: NssFieldProps) {
  const [revealed, setRevealed] = useState(false)
  const isDiscrete = useDiscreteModeStore((s) => s.isDiscreteMode)
  const shown = revealed && !isDiscrete
  const masked = Boolean(saved) && !shown

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          maxLength={14}
          placeholder="11 dígitos"
          value={masked && saved ? (isDiscrete ? '•'.repeat(saved.length) : maskNss(saved)) : value}
          readOnly={masked}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
        />
        {saved && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setRevealed((r) => !r)}
            disabled={isDiscrete}
            aria-label={shown ? 'Ocultar NSS' : 'Mostrar NSS'}
            title={isDiscrete ? 'Modo discreto activo' : undefined}
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
