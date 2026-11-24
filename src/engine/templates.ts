import kineticEnergy from '../templates/kinetic-energy.json'
import { parseWorkspace } from './storageAdapter'
import type { Workspace } from '../types/workspace'

export interface Template {
  id: string
  title: string
  description: string
  category: string
  thumbnail: string
  payload: unknown
}

export const templates: readonly Template[] = [kineticEnergy]

export function newBlankWorkspace(): Workspace {
  return { blocks: {}, plots: [], activeFormulaSymbol: '', cellFormats: {}, columnWidths: {} }
}

export function instantiateTemplate(template: Template): Workspace {
  const workspace = parseWorkspace(JSON.stringify(template.payload))
  for (const block of Object.values(workspace.blocks)) block.id = crypto.randomUUID()
  for (const plot of workspace.plots) plot.id = crypto.randomUUID()
  return workspace
}
