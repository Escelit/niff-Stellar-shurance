'use client'

import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useWallet } from '../hooks/useWallet'

const NETWORK_LABELS: Record<string, string> = {
  testnet: 'Testnet',
  mainnet: 'Mainnet (Public)',
  futurenet: 'Futurenet',
}

/**
 * Renders a non-dismissible blocking modal when the wallet's active network
 * does not match the app's selected network. All transaction UI is blocked
 * until the user switches their wallet network.
 */
export function NetworkMismatchModal() {
  const { networkMismatch, appNetwork } = useWallet()

  return (
    <Dialog open={networkMismatch} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm"
        // Prevent closing via Escape or overlay click
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <DialogTitle className="text-destructive">Network Mismatch</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            Your wallet is connected to a different network than this app.
            <br /><br />
            Please switch your wallet network to{' '}
            <strong>{NETWORK_LABELS[appNetwork] ?? appNetwork}</strong> to continue.
            Transactions are blocked until the networks match.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
