export type HostActivityLevel = 'info' | 'warn' | 'error';

export type HostActivityEntry = {
  id: string;
  at: number;
  message: string;
  level: HostActivityLevel;
};

const MAX_ENTRIES = 120;

export function appendHostActivity(
  prev: HostActivityEntry[],
  message: string,
  level: HostActivityLevel = 'info',
): HostActivityEntry[] {
  const entry: HostActivityEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    message,
    level,
  };
  return [entry, ...prev].slice(0, MAX_ENTRIES);
}
