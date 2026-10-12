// Countries whose Natural Earth admin-1 units are municipalities/provinces; merge them by NE's `region` field
// to get meaningful first-level subdivisions.
export const GROUP_BY_REGION_FIELD = new Set([
  'GBR', 'SVN', 'LVA', 'PHL', 'UGA', 'ITA', 'FRA', 'MKD', 'AZE', 'MLT', 'IRL', 'KOS', 'HUN', 'GIN', 'BFA',
]);

// Land units merged into a single region regardless of their admin-1 split.
export const MERGE_WHOLE = new Set(['BHS', 'HKG', 'MAC', 'SYC', 'CPV', 'MDV']);

// Land units smaller than this (km²) are merged into a single region.
export const MERGE_WHOLE_BELOW_KM2 = 5000;

export const SIMPLIFY_PERCENT = '6%';
