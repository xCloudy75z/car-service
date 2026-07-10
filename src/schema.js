// The single registry of job tags + default intervals + version + thresholds.
// Every other module reads tags/intervals from here (no scattering).

export const CURRENT_VERSION = 2;

export const JOBS = {
  oil:          { label: "Engine oil",   icon: "🛢️", predicted: true },
  air_filter:   { label: "Air filter",   icon: "💨", predicted: true },
  cabin_filter: { label: "Cabin filter", icon: "❄️", predicted: true },
  brake_fluid:  { label: "Brake fluid",  icon: "🛑", predicted: true },
  spark_plugs:  { label: "Spark plugs",  icon: "⚡", predicted: true },
  brakes:       { label: "Brakes",       icon: "🅿️", predicted: false },
  tires:        { label: "Tyres",        icon: "🛞", predicted: false },
  battery:      { label: "Battery",      icon: "🔋", predicted: false },
  transmission: { label: "Transmission", icon: "⚙️", predicted: false },
  suspension:   { label: "Suspension",   icon: "🔩", predicted: false },
  engine:       { label: "Engine",       icon: "🚗", predicted: false }
};

export const DEFAULT_INTERVALS = {
  oil:          { km: 10000 },
  air_filter:   { km: 20000 },
  cabin_filter: { km: 20000, timeHintMonths: 12 },
  brake_fluid:  { km: 40000, timeHintMonths: 24 },
  spark_plugs:  { km: 100000 }
};

// Due-soon window: 10% of the interval, capped at 1000 km.
export const dueSoonKm = (intervalKm) => Math.min(intervalKm * 0.1, 1000);
