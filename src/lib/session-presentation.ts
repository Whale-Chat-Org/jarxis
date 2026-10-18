import Bowser from 'bowser';

/** Shared device vocabulary; user-agent strings are never used as display labels. */
export function describeSessionDevice(userAgent?: string | null) {
  const agent = userAgent ? Bowser.parse(userAgent) : undefined;
  return {
    name: [agent?.browser.name || 'Unknown Browser', agent?.os.name].filter(Boolean).join(', '),
    mobile: agent?.platform.type === 'mobile' || agent?.platform.type === 'tablet',
  };
}

export function sessionAge(date: Date, now = Date.now()) {
  const seconds = Math.floor((now - date.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, duration] of [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ] as const) {
    if (seconds >= duration) return format.format(-Math.floor(seconds / duration), unit);
  }
  return format.format(0, 'second');
}
