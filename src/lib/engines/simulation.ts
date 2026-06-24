/**
 * Simulation Engine
 * Runs branching clinical scenarios.
 */

export interface ScenarioNode {
  id: string;
  prompt: string;
  options: ScenarioOption[];
  isTerminal?: boolean;
  feedback?: string;
}

export interface ScenarioOption {
  id: string;
  label: string;
  nextNodeId: string | null;
  isCorrect: boolean;
  rationale?: string;
}

export interface SimulationState {
  scenarioId: string;
  currentNodeId: string;
  history: string[];
  score: number;
  maxScore: number;
  completed: boolean;
}

export function initSimulation(scenario: { id: string; startNodeId: string; totalNodes: number }): SimulationState {
  return {
    scenarioId: scenario.id,
    currentNodeId: scenario.startNodeId,
    history: [],
    score: 0,
    maxScore: scenario.totalNodes,
    completed: false,
  };
}

export function applyChoice(
  state: SimulationState,
  option: ScenarioOption,
  nextNode: ScenarioNode | null
): SimulationState {
  return {
    ...state,
    history: [...state.history, option.id],
    score: option.isCorrect ? state.score + 1 : state.score,
    currentNodeId: nextNode?.id ?? state.currentNodeId,
    completed: nextNode?.isTerminal ?? !nextNode,
  };
}

export function simulationScore(state: SimulationState): number {
  if (state.maxScore === 0) return 0;
  return Math.round((state.score / state.maxScore) * 100);
}
