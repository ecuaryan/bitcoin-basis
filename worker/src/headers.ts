// Security headers for every response. The Worker adds them to API responses;
// static assets never reach the Worker (`run_worker_first` is `/api/*` only), so
// app/public/_headers carries the same set for them. A test checks the two match.

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://mempool.space",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const DENIED = [
  'accelerometer', 'ambient-light-sensor', 'autoplay', 'bluetooth', 'camera', 'display-capture',
  'encrypted-media', 'geolocation', 'gyroscope', 'hid', 'idle-detection', 'magnetometer',
  'microphone', 'midi', 'payment', 'screen-wake-lock', 'serial', 'usb', 'xr-spatial-tracking',
];

export const PERMISSIONS_POLICY = [
  ...DENIED.map((f) => `${f}=()`),
  'publickey-credentials-get=(self)',
  'publickey-credentials-create=(self)',
].join(', ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': PERMISSIONS_POLICY,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
