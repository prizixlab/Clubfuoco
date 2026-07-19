import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { deriveSurveyPreferences, type SurveyRowInput } from '@/lib/survey-preferences'

/**
 * GET /api/surveys/preferences
 *
 * Aggregates all of the user's survey responses into a preference profile
 * that the explore page uses for personalised recommendations. Both clients
 * consume this route (the iOS app included) so the derivation lives once, in
 * deriveSurveyPreferences() — change it there, with its unit tests.
 *
 * NOTE the select reads clubs.general_entry_price, not price_level — the
 * production clubs table has no price_level column (schema drift), and
 * selecting it makes PostgREST 42703 the whole query.
 */
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { data: surveys, error } = await supabase
    .from('booking_surveys')
    .select(`
      rating, drinks, drink_ratings, drink_kinds, music_genres,
      vibe_rating, crowd_rating, would_return,
      bookings ( booking_date, clubs ( id, name, general_entry_price ) )
    `)
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })

  if (error) return err(error.message)
  return ok(deriveSurveyPreferences((surveys ?? []) as unknown as SurveyRowInput[]))
}
