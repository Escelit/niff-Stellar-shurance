'use client'

import { useWalletContext } from '../context/WalletContext'
import { getManifest } from '@/config/networkManifest'

/**
 * Primary wallet hook — re-exports context values and adds
 * derived helpers consumed by the rest of the app.
 */
export function useWallet() {
  const ctx = useWalletContext()

  /** Contract IDs for the currently selected app network */
  const contractIds = getManifest(ctx.appNetwork).contractIds

  return {
    ...ctx,
    contractIds,
  }
}
