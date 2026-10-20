/**
 * Customs tariff data (official or commercially licensed sources only).
 * The platform may SUGGEST candidate codes for a human broker/importer to
 * evaluate; it must never make a final classification or file a declaration.
 */
export type TariffLookup = { destinationCountry: string; code?: string; query?: string; asOf?: string };

export type TariffLine = {
  source: string; // dataset name + version/licence reference
  country: string;
  code: string;
  description: string;
  dutyRateText?: string; // verbatim from the source, not computed
  effectiveFrom?: string;
};

export interface TariffDataSource {
  readonly id: string;
  readonly licence: string;
  search(q: TariffLookup): Promise<TariffLine[]>;
}
