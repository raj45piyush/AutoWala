import { supabase } from '../lib/supabase';
import type { Notification } from '../types/database';

export async function getNotifications(limit = 50) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Notification[];
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);

  if (error) {
    throw new Error(error.message);
  }
}

export function subscribeToNotifications(onNotification: (notification: Notification) => void) {
  const channel = supabase
    .channel('autowala-notifications')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications' },
      (payload) => onNotification(payload.new as Notification)
    );

  void channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
