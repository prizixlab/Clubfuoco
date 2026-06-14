/**
 * IAP — web stub.
 *
 * Memberships are sold exclusively through Apple In-App Purchase in the
 * native iOS app (see ios-native/ClubFuoco/Stores/MembershipStore.swift).
 * On the web, `isIapAvailable()` is always false and memberships are
 * presented as "available in the app".
 */

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

const unavailable = () => Promise.reject(new Error('In-app purchases are only available in the iOS app'))

const Iap = {
  getProducts: (_opts: { productIds: string[] }): Promise<{ products: IapProduct[] }> => unavailable(),
  purchase: (_opts: { productId: string }): Promise<IapPurchaseResult> => unavailable(),
  restorePurchases: (): Promise<{ entitlements: IapEntitlement[] }> => unavailable(),
  currentEntitlements: (): Promise<{ entitlements: IapEntitlement[] }> => unavailable(),
  manageSubscriptions: (): Promise<void> => unavailable(),
  addListener: (
    _event: 'transactionUpdate',
    _cb: (data: { productId: string; jws: string }) => void,
  ): Promise<{ remove: () => void }> => Promise.resolve({ remove: () => {} }),
}

/** Always false on the web — StoreKit only exists in the native app. */
export function isIapAvailable(): boolean {
  return false
}

export { Iap }
