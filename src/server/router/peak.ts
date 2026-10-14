// DeepSeek peak block (funnel #21): hard-blocked on weekdays 7-10 PM and 12-4 AM Mountain Time.
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });

export function mtClock(ms: number): { weekday: string; hour: number } {
  const parts = fmt.formatToParts(new Date(ms));
  return { weekday: parts.find((p) => p.type === 'weekday')!.value, hour: Number(parts.find((p) => p.type === 'hour')!.value) };
}

export function deepseekPeak(ms: number): boolean {
  const { weekday, hour } = mtClock(ms);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return (hour >= 19 && hour < 22) || (hour >= 0 && hour < 4);
}
