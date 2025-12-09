/**
 * Maps Zoho region/location to the appropriate domain suffix
 */
export function getZohoDomain(location?: string): string {
  if (!location) {
    return '.com';
  }

  const locationLower = location.toLowerCase();

  switch (locationLower) {
    case 'united states':
    case 'us':
      return '.com';
    case 'europe':
    case 'eu':
      return '.eu';
    case 'india':
    case 'in':
      return '.in';
    case 'australia':
    case 'au':
      return '.com.au';
    case 'japan':
    case 'jp':
      return '.jp';
    case 'canada':
    case 'ca':
      return '.ca';
    case 'china':
    case 'cn':
      return '.com.cn';
    default:
      return '.com';
  }
}

/**
 * Gets the full mail.zoho URL for a given location
 */
export function getMailZohoUrl(location?: string): string {
  const domain = getZohoDomain(location);

  // Canada uses zohocloud.ca instead of zoho.ca
  if (domain === '.ca') {
    return `https://mail.zohocloud${domain}`;
  }

  return `https://mail.zoho${domain}`;
}

/**
 * Gets the full accounts.zoho URL for a given location
 */
export function getAccountsZohoUrl(location?: string): string {
  const domain = getZohoDomain(location);

  // Canada uses zohocloud.ca instead of zoho.ca
  if (domain === '.ca') {
    return `https://accounts.zohocloud${domain}`;
  }

  return `https://accounts.zoho${domain}`;
}
