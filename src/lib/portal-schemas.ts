import { z } from 'zod'

// Zod shapes shared by the portal's offer routes (create + patch validate the
// same merged object, so the VIP/free price rule can't be dodged by a partial
// PATCH). Server-side only.

export const OfferSchema = z.object({
  club_id:     z.string().uuid(),
  kind:        z.enum(['free_guestlist', 'vip_table']),
  title:       z.string().trim().min(1).max(60),
  subtitle:    z.string().trim().min(1).max(200),
  price_eur:   z.number().positive().max(100000).nullable(),
  party_size:  z.number().int().positive().max(100).nullable(),
  time_window: z.string().trim().min(1).max(120),
  valid_days:  z.string().trim().min(1).max(120),
  dress_code:  z.string().trim().min(1).max(200),
  music:       z.string().trim().min(1).max(200),
  sort_order:  z.number().int().min(0).max(1000).optional(),
  is_active:   z.boolean().optional(),   // false = archived (kept, not shown)
  featured:    z.boolean().optional(),   // true = paid front-screen promotion
  capacity:    z.number().int().positive().max(100000).nullable().optional(), // null = no ticket limit
}).superRefine((o, ctx) => {
  if (o.kind === 'vip_table' && o.price_eur == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price_eur'], message: 'VIP tables need a price' })
  }
  if (o.kind === 'free_guestlist' && o.price_eur != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price_eur'], message: 'Free guestlist offers cannot have a price' })
  }
})

// PATCH payload — any subset of the editable fields (club_id stays put; an
// offer moves clubs by delete + re-create). Merged with the existing row and
// re-checked against OfferSchema before writing.
export const OfferPatchSchema = z.object({
  kind:        z.enum(['free_guestlist', 'vip_table']).optional(),
  title:       z.string().trim().min(1).max(60).optional(),
  subtitle:    z.string().trim().min(1).max(200).optional(),
  price_eur:   z.number().positive().max(100000).nullable().optional(),
  party_size:  z.number().int().positive().max(100).nullable().optional(),
  time_window: z.string().trim().min(1).max(120).optional(),
  valid_days:  z.string().trim().min(1).max(120).optional(),
  dress_code:  z.string().trim().min(1).max(200).optional(),
  music:       z.string().trim().min(1).max(200).optional(),
  sort_order:  z.number().int().min(0).max(1000).optional(),
  is_active:   z.boolean().optional(),   // false = archived (kept, not shown)
  featured:    z.boolean().optional(),   // true = paid front-screen promotion
  capacity:    z.number().int().positive().max(100000).nullable().optional(), // null = no ticket limit
}).strict()
