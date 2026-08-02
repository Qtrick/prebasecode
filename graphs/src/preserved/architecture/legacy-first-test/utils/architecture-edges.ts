/** Architecture Graph edge legend + styling constants (variant-based, not category-based). */

export interface ArchitectureEdgeLegendItem {
  color: string
  label: string
  dashed?: boolean
}

export const ARCHITECTURE_EDGE_LEGEND_ITEMS: ArchitectureEdgeLegendItem[] = [
  { color: 'rgba(195,198,215,0.55)', label: 'Import' },
  { color: 'rgba(245,158,11,0.55)', label: 'Entry link' },
  { color: 'rgba(52,211,153,0.55)', label: 'Service use' },
  { color: 'rgba(113,113,122,0.55)', label: 'Utility', dashed: true },
  { color: 'rgba(167,139,250,0.5)', label: 'Component use' },
  { color: 'rgba(168,85,247,0.55)', label: 'Dynamic import', dashed: true },
  { color: 'rgba(113,113,122,0.45)', label: 'Folder link', dashed: true },
  { color: 'rgba(113,113,122,0.28)', label: 'Contains', dashed: true },
  { color: 'rgba(45,212,191,0.65)', label: 'Focused' }
]
