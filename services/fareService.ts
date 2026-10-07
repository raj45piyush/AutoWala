import { supabase } from '../lib/supabase';

export interface FareConfig {
  baseFare: number;
  perKmRate: number;
  minimumFare: number;
  platformFee: number;
  tax: number;
}

export const DEFAULT_FARE_CONFIG: FareConfig = {
  baseFare: 0,
  perKmRate: 1,
  minimumFare: 0,
  platformFee: 0,
  tax: 0,
};

export interface FareBreakdown {
  distanceKm: number;
  distanceFare: number;
  baseFare: number;
  platformFee: number;
  tax: number;
  minimumFare: number;
  totalFare: number;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateFareBreakdown(distanceKm: number, config: FareConfig): FareBreakdown | null {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const rawDistanceFare = distanceKm * config.perKmRate;
  const distanceFare = roundCurrency(rawDistanceFare);
  const subtotal = config.baseFare + rawDistanceFare + config.platformFee + config.tax;
  return {
    distanceKm,
    distanceFare,
    baseFare: config.baseFare,
    platformFee: config.platformFee,
    tax: config.tax,
    minimumFare: config.minimumFare,
    totalFare: roundCurrency(Math.max(subtotal, config.minimumFare)),
  };
}

export function calculateEstimatedFare(distanceKm: number, config: FareConfig = DEFAULT_FARE_CONFIG) {
  return calculateFareBreakdown(distanceKm, config)?.totalFare ?? null;
}

function parseFareConfig(value: unknown): FareConfig {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Fare settings are unavailable. Please try again.');
  }
  const row = value as Record<string, unknown>;
  const config = {
    baseFare: Number(row.base_fare),
    perKmRate: Number(row.per_km_rate),
    minimumFare: Number(row.minimum_fare),
    platformFee: Number(row.platform_fee),
    tax: Number(row.tax),
  };
  if (Object.values(config).some((amount) => !Number.isFinite(amount) || amount < 0)) {
    throw new Error('Fare settings returned invalid values. Please contact support.');
  }
  return config;
}

export async function getFareConfig(): Promise<FareConfig> {
  const { data, error } = await supabase.rpc('get_fare_config');
  if (error) throw new Error('Fare settings could not be loaded. Please check your connection.');
  return parseFareConfig(data);
}

export async function saveFareConfig(config: FareConfig): Promise<FareConfig> {
  const values = [config.baseFare, config.perKmRate, config.minimumFare, config.platformFee, config.tax];
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1_000_000)) {
    throw new Error('Enter fare values between ₹0 and ₹1,000,000.');
  }
  const { data, error } = await supabase.rpc('set_fare_config', {
    p_base_fare: config.baseFare,
    p_per_km_rate: config.perKmRate,
    p_minimum_fare: config.minimumFare,
    p_platform_fee: config.platformFee,
    p_tax: config.tax,
  });
  if (error) throw new Error('Fare settings could not be saved. Please try again.');
  return parseFareConfig(data);
}
