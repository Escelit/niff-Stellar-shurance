'use client'

import { useWallet } from '../hooks/useWallet'
import type { AppNetwork } from '@/config/networkManifest'

const NETWORKS: { value: AppNetwork; label: string }[] = [
  { value: 'testnet', label: 'Testnet' },
  { value: 'mainnet', label: 'Mainnet' },
  { value: 'futurenet', label: 'Futurenet' },
]

export function NetworkSelector() {
  const { appNetwork, setAppNetwork } = useWallet()

  return (
    <select
      value={appNetwork}
      onChange={(e) => setAppNetwork(e.target.value as AppNetwork)}
      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label="Select network"
    >
      {NETWORKS.map((n) => (
        <option key={n.value} value={n.value}>
          {n.label}
        </option>
      ))}
    </select>
  )
}
