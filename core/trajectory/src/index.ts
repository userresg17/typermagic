// core/trajectory/index.ts — superfície pública do @typer/trajectory.

export type { Trajectory, TrajectoryStep, TrajectoryEvent } from "./types.js";
export {
  TrajectoryRecorder,
  verifyTrajectory,
  persistTrajectory,
  loadTrajectories,
  trajectoriesDir,
  recordTrajectory,
} from "./recorder.js";
export {
  collectFromTrajectories,
  trajectoriesToSamples,
  trajectoriesToDataset,
  toOpenAiJsonl,
  toGenericJsonl,
  type Sample,
  type Dataset,
} from "./dataset.js";
