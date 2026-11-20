/** The address of this app, as printed on the kit and shown as a QR code (no path, no fragment). */
export function appAddress(loc: Pick<Location, 'origin'> = window.location): string {
  return `${loc.origin}/`;
}

/** The address without `https://`, for reading aloud. */
export function shortAddress(address: string): string {
  return address.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
