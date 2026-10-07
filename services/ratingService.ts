import { supabase } from '../lib/supabase';
import type { Rating } from '../types/database';

export async function submitRating(input: {
  rideId: string;
  rateeId: string;
  stars: number;
  review?: string;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Please log in to leave a rating.');
  }

  const { data: ride, error: rideError } = await supabase
    .from('rides')
    .select('passenger_id, rider_id, status')
    .eq('id', input.rideId)
    .single();

  if (rideError) {
    throw new Error(rideError.message);
  }

  if (ride.status !== 'completed' || !ride.rider_id) {
    throw new Error('Only completed rides can be rated.');
  }

  const otherParticipant = user.id === ride.passenger_id
    ? ride.rider_id
    : user.id === ride.rider_id
      ? ride.passenger_id
      : null;

  if (input.rateeId !== otherParticipant) {
    throw new Error('You can only rate the other participant in your completed ride.');
  }

  const { data, error } = await supabase
    .from('ratings')
    .insert({
      ride_id: input.rideId,
      passenger_id: ride.passenger_id,
      rider_id: ride.rider_id,
      rater_id: user.id,
      ratee_id: input.rateeId,
      rating: input.stars,
      stars: input.stars,
      review: input.review?.trim() || null,
    })
    .select('*')
    .single();

  if (error) {
    if (error.message.toLowerCase().includes('duplicate')) {
      throw new Error('You have already rated this ride.');
    }
    throw new Error(error.message);
  }

  return data as Rating;
}
