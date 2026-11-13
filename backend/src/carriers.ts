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
  TH: { code: 'thailand-post', name: 'Thailand Post' },
  KR: { code: 'korea-post', name: 'Korea Post' },
  TW: { code: 'taiwan-post', name: 'Chunghwa Post' },
  IN: { code: 'india-post', name: 'India Post' },
  BR: { code: 'correios-brazil', name: 'Correios' },
  RU: { code: 'russian-post', name: 'Russian Post' },
  TR: { code: 'ptt-posta', name: 'PTT' },
  PL: { code: 'poczta-polska', name: 'Poczta Polska' },
  AT: { code: 'austrian-post', name: 'Austrian Post' },
  PT: { code: 'ctt', name: 'CTT' },
  IE: { code: 'an-post', name: 'An Post' },
  NO: { code: 'posten-norge', name: 'Posten Norge' },
  DK: { code: 'postnord-denmark', name: 'PostNord Denmark' },
  FI: { code: 'posti', name: 'Posti' },
  NZ: { code: 'nz-post', name: 'NZ Post' },
  MY: { code: 'pos-malaysia', name: 'Pos Malaysia' },
  ID: { code: 'pos-indonesia', name: 'Pos Indonesia' },
  VN: { code: 'vietnam-post', name: 'Vietnam Post' },
  PH: { code: 'phlpost', name: 'PHLPost' },
  AE: { code: 'emirates-post', name: 'Emirates Post' },
  SA: { code: 'saudi-post', name: 'Saudi Post' },
  ZA: { code: 'south-africa-post', name: 'South African Post Office' },
  MX: { code: 'correos-mexico', name: 'Correos de México' },
  AR: { code: 'correo-argentino', name: 'Correo Argentino' },
  CL: { code: 'correos-chile', name: 'Correos de Chile' },
  LU: { code: 'post-luxembourg', name: 'POST Luxembourg' },
  GR: { code: 'elta', name: 'ELTA' },
  CZ: { code: 'czech-post', name: 'Česká pošta' },
  HU: { code: 'magyar-posta', name: 'Magyar Posta' },
  RO: { code: 'posta-romana', name: 'Poșta Română' },
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

/** Public page for any carrier, shown inside the app when no provider can read the number (opens straight on the result). */
const UNIVERSAL_LINK = (n: string) => `https://parcelsapp.com/en/tracking/${encodeURIComponent(n)}`;

/**
 * Public page where a human can follow the parcel: the carrier's own site when it accepts the number in the
 * URL, otherwise 17TRACK's public page (free, no key). Works whether or not automatic tracking is available.
 */
export function trackingUrl(rawNumber: string, carrierCode?: string | null): string {
  const n = encodeURIComponent(rawNumber.replace(/[\s-]+/g, '').toUpperCase());
  const code = (carrierCode ?? detectCarrier(rawNumber)?.code ?? '').toLowerCase();

  if (code === 'ups') return `https://www.ups.com/track?tracknum=${n}`;
  if (code === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (code === 'usps') return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  if (code.startsWith('dhl') || code.startsWith('deutsche-post')) {
    return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`;
  }
  if (code === 'colissimo' || code === 'la-poste' || code.startsWith('la-poste')) {
    return `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`;
  }
  if (code === 'royal-mail') return `https://www.royalmail.com/track-your-item#/tracking-results/${n}`;
  if (code === 'japan-post') return `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${n}&locale=en`;
  if (code === 'thailand-post') return `https://track.thailandpost.co.th/?trackNumber=${n}`;
  return UNIVERSAL_LINK(rawNumber.replace(/[\s-]+/g, '').toUpperCase());
}

/** What to put in `.env` so a number can be tracked automatically (shown for packages no provider can follow). */
export function setupHint(rawNumber: string): string {
  const code = detectCarrier(rawNumber)?.code ?? '';
  if (code === 'ups') return 'UPS_CLIENT_ID + UPS_CLIENT_SECRET';
  if (code === 'colissimo' || code === 'la-poste') return 'LAPOSTE_API_KEY';
  if (code.startsWith('dhl') || code.startsWith('deutsche-post')) return 'DHL_API_KEY';
  return 'SHIP24_API_KEY';
}
