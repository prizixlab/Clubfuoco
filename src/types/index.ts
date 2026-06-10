// ============================================================
// CLUB FUOCO — Shared TypeScript Types
// ============================================================

export type MembershipTier  = 'free' | 'gold' | 'sapphire' | 'black'
export type UserRole        = 'user' | 'club_staff' | 'club_owner' | 'admin' | 'staff'
export type RumbaSignupStatus = 'confirmed' | 'arrived' | 'denied'
export type BookingType     = 'general' | 'vip'
export type BookingStatus   = 'pending' | 'confirmed' | 'cancelled' | 'used'
export type CrowdLabel      = 'empty' | 'quiet' | 'lively' | 'busy' | 'packed'
export type MembershipStatus = 'active' | 'cancelled' | 'past_due'

export interface User {
  id:                 string
  email:              string
  phone?:             string
  full_name?:         string
  avatar_url?:        string
  membership_tier:    MembershipTier
  stripe_customer_id?: string
  role:               UserRole
  created_at:         string
  last_active_at?:    string
}

export interface Club {
  id:                  string
  name:                string
  slug:                string
  description?:        string
  address?:            string
  neighborhood?:       string
  lat?:                number
  lng?:                number
  cover_image_url?:    string
  gallery_urls?:       string[]
  music_genres?:       string[]
  max_capacity?:       number
  general_entry_price?: number
  vip_table_min_spend?: number
  instagram_handle?:   string
  whatsapp_link?:      string
  is_active:           boolean
  is_featured:         boolean
  owner_user_id?:      string
  created_at:          string
  // joined via supabase query
  live_status?:        LiveStatus | null
  drink_specials?:     DrinkSpecial[]
}

export interface LiveStatus {
  id:                  string
  club_id:             string
  crowd_percentage:    number
  crowd_label:         CrowdLabel
  current_dj?:         string
  dj_photo_url?:       string
  queue_wait_minutes?: number
  is_open:             boolean
  special_note?:       string
  updated_at:          string
  updated_by?:         string
}

export interface Booking {
  id:                        string
  user_id:                   string
  club_id:                   string
  booking_type:              BookingType
  party_size:                number
  booking_date:              string
  arrival_window?:           string
  status:                    BookingStatus
  stripe_payment_intent_id?: string
  stripe_charge_id?:         string
  unit_price?:               number
  total_amount?:             number
  platform_fee?:             number
  qr_code_token:             string
  checked_in_at?:            string
  checked_in_by?:            string
  created_at:                string
  // joined
  clubs?: Pick<Club, 'id' | 'name' | 'cover_image_url' | 'address' | 'neighborhood'>
}

export interface Membership {
  id:                     string
  user_id:                string
  tier:                   Exclude<MembershipTier, 'free'>
  stripe_subscription_id?: string
  stripe_price_id?:       string
  status:                 MembershipStatus
  valid_from?:            string
  valid_until?:           string
  created_at:             string
}

export interface DrinkSpecial {
  id:             string
  club_id:        string
  name?:          string
  description?:   string
  original_price?: number
  special_price?: number
  valid_from?:    string
  valid_until?:   string
  is_active:      boolean
  created_at:     string
}

export interface Review {
  id:         string
  user_id:    string
  club_id:    string
  booking_id?: string
  rating:     number
  body?:      string
  created_at: string
  // joined
  users?: Pick<User, 'full_name' | 'avatar_url'>
}

export interface MembershipPlan {
  tier:            Exclude<MembershipTier, 'free'>
  name:            string
  price_monthly:   number   // in euro cents
  stripe_price_id: string
  perks:           string[]
}

// ---- API response envelope ----
export interface ApiSuccess<T> { data: T;    error: null }
export interface ApiError      { data: null; error: string }
export type ApiResponse<T> = ApiSuccess<T> | ApiError

// ---- Utility ----
export interface OrderSummary {
  subtotal:    number
  discount:    number
  total:       number
  platformFee: number
}

// ---- Rumbas ----
export interface Rumba {
  id:             string
  title:          string
  venue_name:     string
  venue_place_id: string | null
  event_date:     string
  capacity:       number
  description:    string | null
  cover_image:    string | null
  dress_code:     string | null
  is_active:      boolean
  created_by:     string | null
  created_at:     string
  // computed/joined
  signup_count?:  number
}

export interface RumbaSignup {
  id:             string
  rumba_id:       string
  user_id:        string
  name:           string
  email:          string
  plus_ones:      number
  status:         RumbaSignupStatus
  checked_in_at:  string | null
  checked_in_by:  string | null
  created_at:     string
}

// ---- Friends ----
export interface FriendUser {
  id:            string
  full_name:     string | null
  avatar_url:    string | null
  friendship_id: string          // the friendships row connecting us
}

export interface FriendsData {
  friends:  FriendUser[]   // accepted
  incoming: FriendUser[]   // pending requests sent TO me — I can accept/decline
  outgoing: FriendUser[]   // pending requests I sent
}

export type FriendRelation = 'none' | 'friends' | 'incoming' | 'outgoing'

export interface FriendSearchResult {
  id:            string
  full_name:     string | null
  avatar_url:    string | null
  relation:      FriendRelation
  friendship_id: string | null
}

// ---- Group bookings ----
export type GroupRsvp = 'invited' | 'going' | 'maybe' | 'declined'

export interface GroupMember {
  id:               string
  user_id:          string
  full_name:        string | null
  avatar_url:       string | null
  role:             'organizer' | 'member'
  rsvp:             GroupRsvp
  payment_required: boolean
  amount_due:       number | null   // organizer's custom allocation (null = club default)
  charge:           number          // resolved euros this member owes (0 = free guest)
  paid:             boolean
  is_me:            boolean
}

export interface GroupDetail {
  id:            string
  club_id:       string
  club_name:     string
  club_image:    string | null
  organizer_id:  string
  organizer_name: string | null
  booking_type:  BookingType
  booking_date:  string
  invite_code:   string
  status:        'open' | 'closed' | 'cancelled'
  unit_price:    number
  members:       GroupMember[]
  me:            GroupMember | null   // my membership, or null if not a member yet
}
