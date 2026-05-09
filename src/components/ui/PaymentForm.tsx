'use client'

import { useState } from 'react'
import {
  useStripe,
  useElements,
  CardElement,
  Elements,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

const CARD_STYLE = {
  style: {
    base: {
      color: '#e3e2e2',
      fontFamily: 'Inter, sans-serif',
      fontSize: '16px',
      '::placeholder': { color: '#5c403a' },
      backgroundColor: 'transparent',
    },
    invalid: { color: '#ffb4ab' },
  },
}

interface PaymentFormProps {
  totalLabel: string
  onPay: (paymentMethodId: string) => Promise<void>
  loading?: boolean
}

function CardForm({ totalLabel, onPay, loading }: PaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setProcessing(true)
    setError('')

    const card = elements.getElement(CardElement)
    if (!card) { setProcessing(false); return }

    const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
      type: 'card',
      card,
    })

    if (pmError) {
      setError(pmError.message ?? 'Card error')
      setProcessing(false)
      return
    }

    try {
      await onPay(paymentMethod.id)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-gutter">
      <div className="glass-card p-md rounded-xl">
        <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-sm">
          Card Details
        </p>
        <CardElement options={CARD_STYLE} />
      </div>
      {error && <p className="font-body-md text-error text-center">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || processing || loading}
        className="w-full bg-primary-container text-on-primary-container font-h2 py-md rounded-xl neon-glow active:scale-[0.98] transition-transform flex items-center justify-center gap-sm disabled:opacity-50"
      >
        <span>{processing || loading ? 'Processing…' : `Pay ${totalLabel}`}</span>
        {!processing && !loading && <span className="material-symbols-outlined">chevron_right</span>}
      </button>
    </form>
  )
}

export function PaymentForm(props: PaymentFormProps) {
  return (
    <Elements stripe={stripePromise}>
      <CardForm {...props} />
    </Elements>
  )
}
