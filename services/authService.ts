import type { Session, User } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';
import type { AppRole, Profile, Rider, VehicleType } from '../types/database';

export interface UserRegistrationInput {
  fullName: string;
  age: number;
  phone: string;
  email: string;
  password: string;
}

export interface RiderRegistrationInput extends UserRegistrationInput {
  vehicleType: VehicleType;
  vehicleNumber: string;
  vehicleDetails: string;
  licenceNumber: string;
  idProofType: string;
}

export interface Account {
  user: User;
  session: Session | null;
  profile: Profile;
  rider: Rider | null;
}

export interface RiderRegistrationResult {
  user: User | null;
  session: Session | null;
  riderProfileVerified: boolean | null;
}

export class AuthServiceError extends Error {
  readonly originalError: unknown;

  constructor(message: string, originalError: unknown) {
    super(message);
    this.name = 'AuthServiceError';
    this.originalError = originalError;
  }
}

export function getOriginalAuthError(error: unknown) {
  return error instanceof AuthServiceError ? error.originalError : error;
}

export interface AuthErrorDiagnostics {
  message: unknown;
  name: unknown;
  status: unknown;
  code: unknown;
  details: unknown;
  hint: unknown;
  cause?: AuthErrorDiagnostics | unknown;
}

function getErrorField(error: unknown, field: string) {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  return (error as Record<string, unknown>)[field];
}

export function getAuthErrorDiagnostics(
  error: unknown,
  depth = 0
): AuthErrorDiagnostics {
  const message = error instanceof Error ? error.message : getErrorField(error, 'message');
  const name = error instanceof Error ? error.name : getErrorField(error, 'name');
  const cause = getErrorField(error, 'cause');
  const diagnostics: AuthErrorDiagnostics = {
    message,
    name,
    status: getErrorField(error, 'status'),
    code: getErrorField(error, 'code'),
    details: getErrorField(error, 'details'),
    hint: getErrorField(error, 'hint'),
  };

  if (cause !== undefined && cause !== error) {
    diagnostics.cause =
      depth < 2 && typeof cause === 'object' && cause !== null
        ? getAuthErrorDiagnostics(cause, depth + 1)
        : cause;
  }

  return diagnostics;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getErrorMessage(error: unknown) {
  const diagnostics = getAuthErrorDiagnostics(error);

  if (typeof diagnostics.message === 'string' && diagnostics.message !== '{}') {
    return diagnostics.message;
  }

  if (
    diagnostics.cause &&
    typeof diagnostics.cause === 'object' &&
    'message' in diagnostics.cause &&
    typeof diagnostics.cause.message === 'string'
  ) {
    return diagnostics.cause.message;
  }

  if (diagnostics.name === 'AuthRetryableFetchError') {
    return 'The Supabase Auth request could not be completed.';
  }

  return 'Something went wrong. Please try again.';
}

export function getFriendlyAuthError(error: unknown) {
  const diagnostics = getAuthErrorDiagnostics(error);
  const message = getErrorMessage(error).toLowerCase();

  if (diagnostics.name === 'AuthRetryableFetchError') {
    if (typeof diagnostics.status === 'number' && diagnostics.status >= 500) {
      return 'Supabase Auth returned a temporary server error. Please try again.';
    }

    return 'Unable to reach Supabase Auth. Please check your internet connection and try again.';
  }

  if (
    diagnostics.code === 'user_already_exists' ||
    message.includes('user_already_exists') ||
    message.includes('already registered') ||
    message.includes('already been registered') ||
    message.includes('already exists')
  ) {
    return 'This email is already registered. Please log in instead.';
  }

  if (message.includes('invalid email')) {
    return 'Please enter a valid email address.';
  }

  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return 'Email or password is incorrect.';
  }

  if (message.includes('password') && (message.includes('weak') || message.includes('6 characters'))) {
    return 'Password must contain at least 6 characters.';
  }

  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to fetch') ||
    message.includes('timeout')
  ) {
    return 'Network error. Please check your internet connection and try again.';
  }

  return getErrorMessage(error);
}

function validateRegistration(input: UserRegistrationInput) {
  if (!input.fullName.trim() || !input.phone.trim()) {
    throw new Error('Please fill all required fields.');
  }

  if (!Number.isInteger(input.age) || input.age < 10 || input.age > 120) {
    throw new Error('Please enter a valid age.');
  }

  if (!/^\S+@\S+\.\S+$/.test(input.email.trim())) {
    throw new Error('Please enter a valid email address.');
  }

  if (input.password.length < 6) {
    throw new Error('Password must contain at least 6 characters.');
  }
}

async function syncProfileForSession(
  user: User,
  input: UserRegistrationInput,
  role: Exclude<AppRole, 'admin'>
) {
  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      full_name: input.fullName.trim(),
      age: input.age,
      phone: input.phone.trim(),
      email: normalizeEmail(input.email),
      role,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new AuthServiceError(
      `Your account was created, but your profile could not be saved: ${error.message}`,
      error
    );
  }
}

async function signUpWithMetadata(
  input: UserRegistrationInput,
  role: Exclude<AppRole, 'admin'>,
  extraMetadata: Record<string, string> = {}
) {
  validateRegistration(input);

  const requestId = `signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const normalizedEmail = normalizeEmail(input.email);
  const metadata = {
    role,
    full_name: input.fullName.trim(),
    age: String(input.age),
    phone: input.phone.trim(),
    ...extraMetadata,
  };

  console.info('[AutoWala auth] signUp request initiated', {
    requestId,
    role,
    email: normalizedEmail,
  });

  let data: Awaited<ReturnType<typeof supabase.auth.signUp>>['data'];
  let error: Awaited<ReturnType<typeof supabase.auth.signUp>>['error'];

  try {
    ({ data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: input.password,
      options: {
        data: metadata,
      },
    }));
  } catch (requestError) {
    console.error('[AutoWala auth] signUp request threw', {
      requestId,
      error: getAuthErrorDiagnostics(requestError),
    });
    throw new AuthServiceError(getFriendlyAuthError(requestError), requestError);
  }

  console.info('[AutoWala auth] signUp response received', {
    requestId,
    hasUser: Boolean(data?.user),
    hasSession: Boolean(data?.session),
    hasError: Boolean(error),
  });

  if (error) {
    console.error('[AutoWala auth] Supabase returned a signUp error', {
      requestId,
      error: getAuthErrorDiagnostics(error),
    });
    throw new AuthServiceError(getFriendlyAuthError(error), error);
  }

  if (!data.user) {
    throw new Error('Registration could not be completed. Please try again.');
  }

  // The Auth trigger creates rider profiles and rider rows from signup
  // metadata. Authenticated clients intentionally have no riders INSERT
  // policy, so rider registration verifies those trigger-created rows below.
  if (data.session && role === 'user') {
    console.info('[AutoWala auth] profile sync initiated', { requestId });
    try {
      await syncProfileForSession(data.user, input, role);
      console.info('[AutoWala auth] profile sync succeeded', { requestId });
    } catch (profileError) {
      console.error('[AutoWala auth] profile sync failed', {
        requestId,
        error: getAuthErrorDiagnostics(getOriginalAuthError(profileError)),
      });
      throw profileError;
    }
  }

  return data;
}

export async function registerUser(input: UserRegistrationInput) {
  return signUpWithMetadata(input, 'user');
}

export async function registerRider(
  input: RiderRegistrationInput
): Promise<RiderRegistrationResult> {
  const data = await signUpWithMetadata(input, 'rider', {
    vehicle_type: input.vehicleType,
    vehicle_number: input.vehicleNumber.trim(),
    vehicle_details: input.vehicleDetails.trim(),
    licence_number: input.licenceNumber.trim(),
    id_proof_type: input.idProofType,
  });

  let riderProfileVerified: boolean | null = null;
  if (data.session && data.user) {
    try {
      const [profile, rider] = await Promise.all([
        getProfile(data.user.id),
        getRider(data.user.id),
      ]);
      riderProfileVerified = Boolean(profile?.role === 'rider' && rider);

      if (!riderProfileVerified) {
        console.error('[AutoWala auth] rider profile verification failed', {
          reason: 'Rider profile or rider row is missing after signup.',
        });
      }
    } catch (verificationError) {
      riderProfileVerified = false;
      console.error('[AutoWala auth] rider profile verification failed', {
        error: getAuthErrorDiagnostics(verificationError),
      });
    }
  }

  return {
    user: data.user,
    session: data.session,
    riderProfileVerified,
  };
}

export async function signIn(email: string, password: string) {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
    throw new Error('Please enter a valid email address.');
  }

  if (!password) {
    throw new Error('Please enter your password.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });

  if (error) {
    throw new Error(getFriendlyAuthError(error));
  }

  return data;
}

async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as Profile | null) ?? null;
}

async function getRider(userId: string) {
  const { data, error } = await supabase
    .from('riders')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as Rider | null) ?? null;
}

async function createMissingAccountRecords(user: User) {
  const metadata = user.user_metadata ?? {};
  const role: Exclude<AppRole, 'admin'> = metadata.role === 'rider' ? 'rider' : 'user';
  const profile = await getProfile(user.id);

  if (!profile) {
    const { error } = await supabase.from('profiles').insert({
      id: user.id,
      full_name: typeof metadata.full_name === 'string' ? metadata.full_name : 'AutoWala user',
      age: typeof metadata.age === 'string' ? Number(metadata.age) || null : null,
      phone: typeof metadata.phone === 'string' ? metadata.phone : null,
      email: user.email ?? null,
      role,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  const resolvedProfile = (await getProfile(user.id)) as Profile;
  let rider = resolvedProfile.role === 'rider' ? await getRider(user.id) : null;

  if (resolvedProfile.role === 'rider' && !rider) {
    const { data, error } = await supabase
      .from('riders')
      .insert({
        profile_id: user.id,
        user_id: user.id,
        vehicle_type: metadata.vehicle_type === 'toto' ? 'toto' : 'auto',
        vehicle_number: typeof metadata.vehicle_number === 'string' ? metadata.vehicle_number : null,
        vehicle_details: typeof metadata.vehicle_details === 'string' ? metadata.vehicle_details : null,
        licence_number: typeof metadata.licence_number === 'string' ? metadata.licence_number : null,
        id_proof_type: typeof metadata.id_proof_type === 'string' ? metadata.id_proof_type : null,
        approval_status: 'pending',
        is_online: false,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    rider = data as Rider;
  }

  return { profile: resolvedProfile, rider };
}

export async function getCurrentAccount(): Promise<Account | null> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw new Error(getFriendlyAuthError(error));
  }

  if (!session?.user) {
    return null;
  }

  const { profile, rider } = await createMissingAccountRecords(session.user);
  return { user: session.user, session, profile, rider };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(getFriendlyAuthError(error));
  }
}

export async function updateProfile(input: {
  fullName: string;
  age: number;
  phone: string;
}) {
  const userId = await (async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Please log in to update your profile.');
    }
    return user.id;
  })();

  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name: input.fullName.trim(), age: input.age, phone: input.phone.trim() })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Profile;
}

export async function updateRiderDetails(input: {
  vehicleType: VehicleType;
  vehicleNumber: string;
  vehicleDetails: string;
  licenceNumber: string;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Please log in to update rider details.');
  }

  const { data, error } = await supabase
    .from('riders')
    .update({
      vehicle_type: input.vehicleType,
      vehicle_number: input.vehicleNumber.trim(),
      vehicle_details: input.vehicleDetails.trim() || null,
      licence_number: input.licenceNumber.trim(),
    })
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Rider;
}

export function subscribeToAuthChanges(callback: () => void) {
  const { data } = supabase.auth.onAuthStateChange(() => callback());
  return () => data.subscription.unsubscribe();
}
