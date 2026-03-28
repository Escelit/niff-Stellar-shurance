'use client'

/**
 * Truncates a Stellar public key for display.
 * e.g. GDVOE...S4TYW
 */
export function truncateAddress(address: string, chars = 5): string {
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}
