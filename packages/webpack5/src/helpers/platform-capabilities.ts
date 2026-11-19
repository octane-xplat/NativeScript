/**
 * Behavior capability tables consumed by `@nativescript/core` through
 * `__NS_CAP__.*` define substitutions. These are the same values
 * `builtinPlatforms[*].capabilities` declares in
 * `@nativescript/vite/helpers/platforms.ts` — `platforms.spec.ts` there
 * asserts the two tables stay in parity, so update both together.
 *
 * Semantics (values must equal the platform expressions they replace):
 *  - `propertyChangesRequestLayout` replaces `affectsLayout: __APPLE__` —
 *    Core drives native layout in JS, so a property change must request a
 *    layout pass.
 *  - `textChangeAffectsLayout` replaces `affectsLayout: __ANDROID__` on the
 *    `text` property — content edits trigger re-measure on Android's
 *    TextView.
 */
export const platformCapabilities: Record<string, Record<string, boolean>> = {
	ios: {
		propertyChangesRequestLayout: true,
		textChangeAffectsLayout: false,
	},
	visionos: {
		propertyChangesRequestLayout: true,
		textChangeAffectsLayout: false,
	},
	android: {
		propertyChangesRequestLayout: false,
		textChangeAffectsLayout: true,
	},
};

/**
 * DefinePlugin entries for a platform: one dotted `__NS_CAP__.<cap>` key per
 * capability (so member reads substitute to constants) plus the bare
 * `__NS_CAP__` object for whole-object reads. Unknown/custom platforms get an
 * empty capability set — matching `@nativescript/vite`'s fallback.
 */
export function getPlatformCapabilityDefines(
	platform: string,
): Record<string, unknown> {
	const capabilities = platformCapabilities[platform] ?? {};
	return {
		...Object.fromEntries(
			Object.entries(capabilities).map(([cap, value]) => [
				`__NS_CAP__.${cap}`,
				value,
			]),
		),
		__NS_CAP__: capabilities,
	};
}
