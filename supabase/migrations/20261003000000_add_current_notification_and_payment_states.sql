-- Add labels in an isolated migration so following migrations can write them.
do $types$
begin
  alter type public.notification_kind add value if not exists 'rider_arrived';
  alter type public.notification_kind add value if not exists 'passenger_picked_up';
  alter type public.notification_kind add value if not exists 'ride_in_progress';
  alter type public.notification_kind add value if not exists 'ride_cancelled';
  alter type public.payment_status add value if not exists 'processing';
end;
$types$;
