import { supabase } from './supabase';

export async function testSupabaseConnection() {
  const { error } = await supabase.auth.getSession();

  if (error) {
    console.log('Supabase connection error:', error.message);
    return false;
  }

  console.log('Supabase connection successful');
  return true;
}







