import { NextResponse } from 'next/server'
import type { ApiResponse } from '@/types'

// Typed success response
export function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ data, error: null }, { status })
}

// Error response
export function err(message: string, status = 400): NextResponse {
  return NextResponse.json({ data: null, error: message }, { status })
}

// Generates a UUID string for QR tokens
export function generateQRToken(): string {
  return crypto.randomUUID()
}

// Derives a crowd label string from a percentage
export function crowdLabelFromPercent(
  pct: number
): 'empty' | 'quiet' | 'lively' | 'busy' | 'packed' {
  if (pct < 20) return 'empty'
  if (pct < 45) return 'quiet'
  if (pct < 65) return 'lively'
  if (pct < 85) return 'busy'
  return 'packed'
}
