/** Número de Seguridad Social (IMSS): 11 digits, the last one a Luhn check digit (#122). */

export const NSS_LENGTH = 11

/** Strips the spaces and dashes people type when copying it from a document. */
export function normalizeNss(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

function luhnCheckDigit(digits: string): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return (10 - (sum % 10)) % 10
}

/** Spanish message for the user, or null when the (normalized) NSS is valid. */
export function nssError(nss: string): string | null {
  if (!/^\d+$/.test(nss)) return 'El NSS solo lleva números'
  if (nss.length !== NSS_LENGTH) return `El NSS debe tener ${NSS_LENGTH} dígitos`
  if (luhnCheckDigit(nss.slice(0, -1)) !== Number(nss.at(-1))) {
    return 'El NSS no es válido: revisa que no falte o sobre un dígito'
  }
  return null
}

export function maskNss(nss: string): string {
  return '•'.repeat(Math.max(0, nss.length - 4)) + nss.slice(-4)
}
