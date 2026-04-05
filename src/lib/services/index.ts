/**
 * @file services/index.ts
 * @description Barrel export for application service modules.
 */

export {
	routeCapture,
	routeCaptureWithAI,
	loadCorrections,
	recordCorrection,
	type RouteResult,
	type RouteConfidence,
	type RouteCaptureInput,
	type BoardSummary,
	type AIClassifyFn
} from './captureRouter';
