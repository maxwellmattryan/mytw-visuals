export { createStageController, RING_RADIUS, ROTATE_RADIUS, SELECT_HINT } from './controller'
export type {
	GestureKind,
	Gizmo,
	SelectedLayer,
	StageController,
	StageControllerOptions,
} from './controller'
export {
	angleDelta,
	angleFromUp,
	baseTransform,
	canvasToSource,
	clampZoom,
	layerQuad,
	MAX_ZOOM,
	MIN_ZOOM,
	panTransform,
	rotateByScreenAngle,
	screenAngle,
	sourceSize,
	sourceToCanvas,
	zoomTransformAbout,
} from './geometry'
export type { BaseTransform, Size, Vec2 } from './geometry'
export {
	actualSize,
	canvasToStage,
	FIT_PADDING,
	fitView,
	MAX_VIEW_SCALE,
	MIN_VIEW_SCALE,
	panView,
	stageToCanvas,
	zoomViewAt,
} from './viewport'
export type { View } from './viewport'
export { ASPECT_GUIDES, aspectRect, safeAreas } from './guides'
export type { AspectGuide, Rect } from './guides'
export { describeReveal, findEdgeReveals } from './coverage'
export type { EdgeReveal } from './coverage'
export { mountStage } from './mount'
export type { MountedStage, MountStageOptions } from './mount'
export { default as StageOverlay } from './StageOverlay.svelte'
