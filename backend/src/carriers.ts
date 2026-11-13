export interface DetectedCarrier {
  code: string;
  name: string;
}

const ups: DetectedCarrier = { code: 'ups', name: 'UPS' };
const fedex: DetectedCarrier = { code: 'fedex', name: 'FedEx' };
const usps: DetectedCarrier = { code: 'usps', name: 'USPS' };
const dhl: DetectedCarrier = { code: 'dhl', name: 'DHL' };
const amazon: DetectedCarrier = { code: 'amazon-logistics', name: 'Amazon Logistics' };
const colissimo: DetectedCarrier = { code: 'colissimo', name: 'Colissimo' };

/** Universal Postal Union "S10" numbers (AB123456789CD): the last two letters are the origin country. */
const POSTAL_OPERATORS: Record<string, DetectedCarrier> = {
  FR: { code: 'la-poste', name: 'La Poste' },
  GB: { code: 'royal-mail', name: 'Royal Mail' },
  US: usps,
  CN: { code: 'china-post', name: 'China Post' },
  HK: { code: 'hong-kong-post', name: 'Hongkong Post' },
  DE: { code: 'dhl-paket', name: 'DHL Paket' },
  NL: { code: 'postnl', name: 'PostNL' },
  BE: { code: 'bpost', name: 'bpost' },
  ES: { code: 'correos', name: 'Correos' },
  IT: { code: 'poste-italiane', name: 'Poste Italiane' },
  CH: { code: 'swiss-post', name: 'Swiss Post' },
  SE: { code: 'postnord', name: 'PostNord' },
  CA: { code: 'canada-post', name: 'Canada Post' },
  AU: { code: 'australia-post', name: 'Australia Post' },
  JP: { code: 'japan-post', name: 'Japan Post' },
  SG: { code: 'singapore-post', name: 'Singapore Post' },
};

/**
 * Best guess of the carrier from the shape of a tracking number. Purely local, no API call.
 * Only formats that are reasonably distinctive are recognized: a wrong guess is worse than none,
 * and the tracking providers still do their own detection.
 */
export function detectCarrier(rawNumber: string): DetectedCarrier | null {
  const n = rawNumber.replace(/[\s-]+/g, '').toUpperCase();

  if (/^1Z[0-9A-Z]{16}$/.test(n)) return ups;
  if (/^TBA\d{12}$/.test(n)) return amazon;
  if (/^9[2-5]\d{18,22}$/.test(n)) return usps;

  if (/^0034\d{16}$/.test(n)) return { code: 'dhl-paket', name: 'DHL Paket' };
  if (/^(GM|LX|RX)\d{10,18}$/.test(n)) return { code: 'dhl-ecommerce', name: 'DHL eCommerce' };

  const s10 = /^[A-Z]{2}\d{9}([A-Z]{2})$/.exec(n);
  if (s10) return POSTAL_OPERATORS[s10[1]!] ?? null;

  if (/^[0-9][A-Z]\d{11}$/.test(n)) return colissimo;
  if (/^(JJD|JVGL)\d{8,}$/.test(n)) return dhl;
  if (/^YT\d{16}$/.test(n)) return { code: 'yunexpress', name: 'YunExpress' };
  if (/^LP\d{14}$/.test(n)) return { code: 'cainiao', name: 'Cainiao' };
  if (/^SF\d{12,15}$/.test(n)) return { code: 'sf-express', name: 'SF Express' };
  if (/^JT\d{13}$/.test(n)) return { code: 'j-t-express', name: 'J&T Express' };

  if (/^\d{12}$|^\d{15}$/.test(n)) return fedex;
  if (/^\d{10}$/.test(n)) return dhl;
  return null;
}

const ACRONYMS = new Set(['dhl', 'dpd', 'gls', 'tnt', 'ups', 'usps', 'ems', 'uk', 'us']);

/** Shapes the DHL tracking API accepts (Paket, Express, eCommerce). */
export function isDhlNumber(rawNumber: string): boolean {
  const n = rawNumber.replace(/[\s-]+/g, '').toUpperCase();
  return detectCarrier(n)?.code.startsWith('dhl') === true || /^(\d{10}|\d{20}|JJD\d+|JVGL\d+)$/.test(n);
}

/** Human-friendly name for a provider carrier slug (AfterShip uses slugs such as "usps"). */
export function carrierDisplayName(slug: string): string {
  const known = [ups, fedex, usps, dhl, amazon, colissimo, ...Object.values(POSTAL_OPERATORS)].find(
    (c) => c.code === slug,
  );
  if (known) return known.name;
  const aliases: Record<string, string> = {
    'la-poste-colissimo': 'Colissimo',
    'chronopost-france': 'Chronopost',
    'dhl-ecommerce': 'DHL eCommerce',
    'fedex-freight': 'FedEx Freight',
    'dpd-uk': 'DPD UK',
  };
  if (aliases[slug]) return aliases[slug];
  return slug
    .split('-')
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}
