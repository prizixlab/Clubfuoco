/**
 * IAP — TypeScript wrapper around the native `Iap` StoreKit 2 plugin.
 *
 * Only functional inside the native iOS app. On web, `isIapAvailable()`
 * returns false and memberships are presented as "available in the app".
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface IapProduct {
  productId:    string
  displayName:  string
  description:  string
  displayPrice: string
  price:        number
}

export interface IapEntitlement {
  productId: string
  jws:       string
}

export interface IapPurchaseResult {
  status:    'purchased' | 'cancelled' | 'pending'
  productId?: string
  jws?:      string
}

interface IapPlugin {
  getProducts(opts: { productIds: string[] }): Promise<{ products: IapProduct[] }>
  purchase(opts: { productId: string }): Promise<IapPurchaseResult>
  restorePurchases(): Promise<{ entitlements: IapEntitlement[] }>
  currentEntitlements(): Promise<{ entitlements: IapEntitlement[] }>
  manageSubscriptions(): Promise<void>
  addListener(
    event: 'transactionUpdate',
    cb: (data: { productId: string; jws: string }) => void,
  ): Promise<{ remove: () => void }>
}

const Iap = registerPlugin<IapPlugin>('Iap')

/** True only when running in the native iOS app where StoreKit exists. */
export function isIapAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}

export { Iap }
