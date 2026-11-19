/**
 * The platforms NativeScript builds for. Single source of truth for the build
 * pipeline. The built-in names keep literal types for narrowing; the widened
 * union admits externally registered platforms (see helpers/platforms.ts).
 */
export type Platform = 'android' | 'ios' | 'visionos' | (string & {});
