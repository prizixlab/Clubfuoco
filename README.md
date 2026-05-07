# Club Fuoco 🔥

**Real-time nightlife discovery for Barcelona.**
_"Where the night begins before you arrive."_

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS (Barcelona Noir design system) |
| Database | Supabase (PostgreSQL + Row Level Security) |
| Auth | Supabase Auth (email + Google OAuth) |
| Payments | Stripe (bookings + subscriptions) |
| QR Codes | qrcode npm package |
| Validation | Zod |

---

## Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env.local
# Fill in your Supabase and Stripe keys
```

### 3. Set up the database

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** in your Supabase dashboard
3. Run `supabase/migrations/001_initial_schema.sql`
4. Run `supabase/seed.sql` (seeds 5 partner clubs)

### 4. Configure Supabase Auth

In Supabase Dashboard → Authentication → Providers:
- Enable **Email** provider
- Enable **Google** provider (add OAuth credentials from Google Cloud Console)

Set the redirect URL: `https://your-domain.com/api/auth/callback`

### 5. Set up Stripe

1. Create products in [Stripe Dashboard](https://dashboard.stripe.com/products):
   - **Gold** membership: €19/month recurring → copy Price ID to `STRIPE_PRICE_GOLD`
   - **Sapphire** membership: €49/month recurring → copy Price ID to `STRIPE_PRICE_SAPPHIRE`

2. Set up webhook endpoint:
   - URL: `https://your-domain.com/api/webhooks/stripe`
   - Events to listen for:
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`

3. For local webhook testing:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

### 6. Run the dev server
```bash
npm run dev
```

---

## API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/me` | Current user profile |
| GET | `/api/auth/callback` | OAuth redirect handler |

### Clubs
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/clubs` | List clubs (`?genre=house&open_now=true&featured=true`) |
| GET | `/api/clubs/:id` | Club detail + live status + specials |
| GET | `/api/clubs/:id/live` | Live status only (poll every 60s) |
| GET | `/api/clubs/:id/specials` | Active drink specials |
| GET | `/api/clubs/:id/reviews` | Paginated reviews |
| POST | `/api/clubs/:id/reviews` | Submit a review (auth required, must have booking) |

### Bookings
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/bookings` | User's booking history |
| POST | `/api/bookings` | Create booking + Stripe payment |
| GET | `/api/bookings/:id` | Single booking detail |
| DELETE | `/api/bookings/:id` | Cancel + refund |
| GET | `/api/bookings/:id/qr` | QR code as base64 PNG |
| POST | `/api/bookings/verify/:token` | Check in via QR scan (staff only) |

### Favorites
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/favorites` | User's saved clubs |
| POST | `/api/favorites/:clubId` | Save a club |
| DELETE | `/api/favorites/:clubId` | Unsave a club |

### Memberships
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/memberships/plans` | Available plans and pricing |
| GET | `/api/memberships/me` | Current user's membership |
| POST | `/api/memberships/subscribe` | Subscribe to a tier |
| POST | `/api/memberships/cancel` | Cancel subscription |

### Admin (club staff / owner / admin role)
| Method | Endpoint | Description |
|---|---|---|
| PATCH | `/api/admin/clubs/:id/live` | Update crowd level, DJ, open status |
| GET | `/api/admin/clubs/:id/specials` | Manage drink specials |
| POST | `/api/admin/clubs/:id/specials` | Add a drink special |
| POST | `/api/admin/bookings/:id/checkin` | Manual check-in by booking ID |

### Webhooks
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/webhooks/stripe` | Stripe event handler |

---

## Database Schema

Tables: `users`, `clubs`, `live_status`, `bookings`, `memberships`, `drink_specials`, `favorites`, `reviews`

See `supabase/migrations/001_initial_schema.sql` for the full schema with RLS policies.

---

## Membership Tiers

| Tier | Price | Key Perks |
|---|---|---|
| Free | €0 | Browse, view live status |
| Gold | €19/month | 15% discount on bookings, priority entry, monthly guest pass |
| Sapphire | €49/month | 25% discount, free guestlist (4x/month), personal concierge |

---

## Project Structure

```
src/
├── app/
│   ├── api/              ← All API routes
│   │   ├── auth/
│   │   ├── clubs/
│   │   ├── bookings/
│   │   ├── favorites/
│   │   ├── memberships/
│   │   ├── admin/
│   │   └── webhooks/
│   ├── globals.css       ← Barcelona Noir CSS utilities
│   └── layout.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts     ← Browser client
│   │   └── server.ts     ← Server + service clients
│   ├── auth.ts           ← requireAuth(), requireRole()
│   ├── stripe.ts         ← Stripe client + pricing logic
│   ├── qr.ts             ← QR code generation
│   └── utils.ts          ← ok(), err() response helpers
├── middleware.ts          ← Session refresh + admin route protection
└── types/
    └── index.ts          ← All TypeScript interfaces

supabase/
├── migrations/
│   └── 001_initial_schema.sql
└── seed.sql
```
