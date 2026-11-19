import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { normalizeModuleId } from './normalize-id.js';

/**
 * A platform NativeScript builds for.
 *
 * Built-in platforms (ios/android/visionos) ship inside @nativescript/core.
 * External platforms are supplied by an outside package and registered through
 * the `platforms` option of `baseConfig`; they select implementations from a
 * provider directory (a tree mirroring @nativescript/core module paths) and/or
 * reuse existing core platform files per module.
 */
export interface NativeScriptPlatform {
	/**
	 * Platform name as passed via `--env.platform=<name>`
	 * (e.g. 'ios', 'android', 'visionos', or an external name like 'testos').
	 */
	name: string;
	/**
	 * Optional platform family. The only supported value today is 'apple',
	 * which sets `__APPLE__`. It never sets `__IOS__` for external platforms;
	 * `__IOS__` remains true only for the literal 'ios' platform.
	 */
	family?: 'apple';
	/**
	 * File-suffix preference for this platform's own files, in priority order
	 * (e.g. ['.ios'] or ['.testos']). visionos keeps ['.ios'] — today's
	 * behavior of resolving visionOS through the iOS file set.
	 */
	suffixes: string[];
	/**
	 * Absolute path to a directory whose tree mirrors @nativescript/core
	 * module paths. `<root>/<module id><suffix>.{ts,js}` shadows the core
	 * module for this platform.
	 */
	provider?: { root: string };
	/**
	 * Map of core module id → suffix of an existing core file, for modules an
	 * external platform deliberately reuses (e.g. `{ 'timer/index': '.ios' }`).
	 */
	reuse?: Record<string, string>;
	/**
	 * Behavior capabilities shared core code branches on via `__NS_CAP__.*`.
	 * Built-in platforms declare values equal to the platform expressions the
	 * code used previously, so built-in output is unchanged.
	 */
	capabilities: Record<string, boolean>;
}

export type BuiltinPlatformName = 'ios' | 'android' | 'visionos';

/**
 * Shared-code behavior flags converted from platform-name checks to
 * `__NS_CAP__.*` capability reads. Values per platform must equal the
 * expression they replace:
 *  - `propertyChangesRequestLayout` replaces `affectsLayout: __APPLE__` (and
 *    the matching `if (__APPLE__) view.requestLayout()` guards) in property
 *    metadata — "Core drives native layout in JS, so a change must request a
 *    layout pass".
 *  - `textChangeAffectsLayout` replaces `affectsLayout: __ANDROID__` in the
 *    `text` property metadata.
 */
const appleCapabilities: Record<string, boolean> = {
	propertyChangesRequestLayout: true,
	textChangeAffectsLayout: false,
};

const androidCapabilities: Record<string, boolean> = {
	propertyChangesRequestLayout: false,
	textChangeAffectsLayout: true,
};

/** The platforms that ship inside @nativescript/core. */
export const builtinPlatforms: Record<BuiltinPlatformName, NativeScriptPlatform> = {
	ios: {
		name: 'ios',
		family: 'apple',
		suffixes: ['.ios'],
		capabilities: { ...appleCapabilities },
	},
	android: {
		name: 'android',
		suffixes: ['.android'],
		capabilities: { ...androidCapabilities },
	},
	visionos: {
		name: 'visionos',
		family: 'apple',
		suffixes: ['.ios'],
		capabilities: { ...appleCapabilities },
	},
};

/**
 * Resolve a platform descriptor by name: built-ins first, then the externally
 * registered list. Unknown names return undefined so callers keep the
 * platform-agnostic fallback behavior they have today.
 */
export function getPlatform(name: string | undefined, external?: NativeScriptPlatform[]): NativeScriptPlatform | undefined {
	if (!name) {
		return undefined;
	}
	const builtin = builtinPlatforms[name as BuiltinPlatformName];
	if (builtin) {
		return builtin;
	}
	return external?.find((platform) => platform.name === name);
}

const BASE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'] as const;
const TRAILING_EXTENSIONS = ['.mjs', '.json'] as const;

/**
 * Vite `resolve.extensions` list for a platform: each platform suffix
 * interleaved before its plain extension (`.testos.tsx`, `.tsx`, …), then the
 * universal tail. `undefined` yields the historical no-platform fallback.
 */
export function getPlatformExtensions(platform: NativeScriptPlatform | undefined): string[] {
	const extensions: string[] = [];
	if (platform && platform.suffixes.length) {
		for (const ext of BASE_EXTENSIONS) {
			for (const suffix of platform.suffixes) {
				extensions.push(`${suffix}${ext}`);
			}
			extensions.push(ext);
		}
	} else {
		extensions.push(...BASE_EXTENSIONS);
	}
	extensions.push(...TRAILING_EXTENSIONS);
	return extensions;
}

/**
 * Values for the platform defines every emitter produces (bundle `define`,
 * runtime seeds, per-module shims). `family: 'apple'` maps to `__APPLE__` for
 * external platforms; `__IOS__`/`__VISIONOS__`/`__ANDROID__` stay keyed to the
 * built-in names so an external platform cannot silently inherit them.
 */
export function getPlatformDefineValues(platform: NativeScriptPlatform | undefined): {
	__ANDROID__: boolean;
	__IOS__: boolean;
	__VISIONOS__: boolean;
	__APPLE__: boolean;
	capabilities: Record<string, boolean>;
} {
	return {
		__ANDROID__: platform?.name === 'android',
		__IOS__: platform?.name === 'ios',
		__VISIONOS__: platform?.name === 'visionos',
		__APPLE__: platform?.family === 'apple',
		capabilities: platform?.capabilities ?? {},
	};
}

/**
 * The platform subset of the Vite `define` map, as string values ready for
 * `config.define`: the four platform flags, one dotted `__NS_CAP__.<cap>`
 * entry per capability, the bare `__NS_CAP__` object, and the legacy
 * `global.isAndroid` / `global.isIOS` members (`isIOS` is
 * `__IOS__ || __VISIONOS__`, matching core/platform/common.ts).
 *
 * Vite configs that do not use `baseConfig` (external-platform apps with
 * their own pipeline) call this instead of re-deriving the map.
 */
export function getPlatformBundleDefines(platform: NativeScriptPlatform | undefined): Record<string, string> {
	const values = getPlatformDefineValues(platform);
	return {
		__ANDROID__: JSON.stringify(values.__ANDROID__),
		__IOS__: JSON.stringify(values.__IOS__),
		__VISIONOS__: JSON.stringify(values.__VISIONOS__),
		__APPLE__: JSON.stringify(values.__APPLE__),
		...Object.fromEntries(Object.entries(values.capabilities).map(([cap, value]) => [`__NS_CAP__.${cap}`, JSON.stringify(value)])),
		__NS_CAP__: JSON.stringify(values.capabilities),
		'global.isAndroid': JSON.stringify(values.__ANDROID__),
		'global.isIOS': JSON.stringify(values.__IOS__ || values.__VISIONOS__),
	};
}

const CORE_PACKAGE_ID = '@nativescript/core';
const PROVIDER_EXTENSIONS = ['.ts', '.js'] as const;
// Core also ships plain shared modules as .mjs (e.g. fetch/index.mjs); step 3
// must see them so they pass through instead of hitting the step-4 error.
const NORMAL_EXTENSIONS = [...PROVIDER_EXTENSIONS, '.mjs'] as const;
const SCRIPT_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.mjs'] as const;
// Suffixes that mean "an existing platform implementation file" when they end
// an import specifier — derived from the registered platforms (built-ins
// plus the active platform's own suffixes), never a hard-coded list.
const BUILTIN_SUFFIXES = [...new Set(Object.values(builtinPlatforms).flatMap((platform) => platform.suffixes))];

function isFile(file: string): boolean {
	try {
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

function isDirectory(dir: string): boolean {
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Resolver for external platform implementations of @nativescript/core
 * modules. `enforce: 'pre'` so it runs before the alias that maps
 * `@nativescript/core/*` to the core root and before the suffix resolver.
 *
 * For an import whose target lies inside `coreRoot` — a relative import from
 * a core (or provider) file, a bare `@nativescript/core/<path>` specifier, or
 * an already-aliased absolute path — the core module id is the path relative
 * to coreRoot without extension (`ui/label`, directories becoming
 * `<dir>/index`). Two kinds of specifier pass through untouched before any
 * resolution runs: non-script imports (`.json`, `.css`, `.xml`, assets) and
 * imports that explicitly name a platform file (`./dep.ios`, `foo.testos.ts`)
 * — a suffix in the specifier is part of the name, not a resolution hint.
 * Resolution order per module id:
 *   1. `<provider.root>/<id><suffix>.{ts,js}` for each platform suffix —
 *      skipped when the importer IS the provider file for that id, so a
 *      provider module can extend the core module it shadows;
 *   2. `<coreRoot>/<id><reuse[id] suffix>.{ts,js}` — the reuse map picks an
 *      existing core implementation (no silent `.ios` fallback);
 *   3. normal resolution — the core shared file `<coreRoot>/<id>.{ts,js}`
 *      (plus the platform's own suffixes inside coreRoot);
 *   4. otherwise throws listing everything checked — never silently falls
 *      back to another platform's file.
 * Results are cached per importer+source. For platforms with neither
 * `provider` nor `reuse` the plugin resolves nothing.
 */
export function platformProviderPlugin(opts: { platform: NativeScriptPlatform | undefined; coreRoot: string; verbose?: boolean }): Plugin {
	const { platform, verbose } = opts;
	// Canonicalize roots to the forward-slash form ids take elsewhere (see
	// normalize-id.ts) so prefix and importer comparisons match on every OS.
	const coreRoot = normalizeModuleId(path.resolve(opts.coreRoot));
	const providerRoot = platform?.provider ? normalizeModuleId(path.resolve(platform.provider.root)) : undefined;
	const reuse = platform?.reuse ?? {};
	const suffixes = platform?.suffixes ?? [];
	// Suffixes that mark an explicit platform-file import for this build:
	// every built-in plus this platform's own.
	const platformSuffixes = [...new Set([...BUILTIN_SUFFIXES, ...suffixes])];
	const enabled = !!providerRoot || Object.keys(reuse).length > 0;
	const cache = new Map<string, string | null>();

	const log = (...args: unknown[]) => {
		if (verbose) {
			console.log(`[platform-provider:${platform?.name ?? 'unknown'}]`, ...args);
		}
	};

	/** Files the provider supplies for a module id, in suffix order. */
	const providerCandidates = (id: string): string[] => (providerRoot ? suffixes.flatMap((suffix) => PROVIDER_EXTENSIONS.map((ext) => `${providerRoot}/${id}${suffix}${ext}`)) : []);

	/** The core files a module id resolves to without provider/reuse. */
	const normalCandidates = (id: string): string[] => [...suffixes.flatMap((suffix) => PROVIDER_EXTENSIONS.map((ext) => `${coreRoot}/${id}${suffix}${ext}`)), ...NORMAL_EXTENSIONS.map((ext) => `${coreRoot}/${id}${ext}`)];

	/**
	 * Core module-id candidates for an import: `<rel>` and, when `<rel>` is a
	 * directory anywhere it could resolve, `<rel>/index`.
	 */
	const moduleIdCandidates = (rel: string): string[] => {
		const ids = [rel];
		if (isDirectory(`${coreRoot}/${rel}`) || (providerRoot && isDirectory(`${providerRoot}/${rel}`))) {
			ids.push(`${rel}/index`);
		}
		return ids;
	};

	const findFirst = (files: string[]): string | undefined => files.find(isFile);

	return {
		name: 'nativescript:platform-provider',
		enforce: 'pre',

		resolveId(source, importer) {
			if (!enabled) {
				return null;
			}

			// '\0' separates importer and source — it cannot appear in either,
			// so keys for ("a","bc") and ("ab","c") can never collide.
			const cacheKey = `${importer ?? ''}\0${source}`;
			if (cache.has(cacheKey)) {
				return cache.get(cacheKey) ?? null;
			}
			const done = (result: string | null) => {
				cache.set(cacheKey, result);
				return result;
			};

			const cleanSource = source.split('?', 1)[0];

			// Anything that is not a script file (`.json`, `.css`, `.scss`,
			// `.xml`, assets, …) is outside this resolver's scope — pass through
			// silently, never error.
			const sourceExt = path.posix.extname(normalizeModuleId(cleanSource));
			if (sourceExt && !(SCRIPT_EXTENSIONS as readonly string[]).includes(sourceExt)) {
				return done(null);
			}

			// Locate the import target relative to coreRoot.
			let rel: string | undefined;
			if (cleanSource === CORE_PACKAGE_ID) {
				rel = 'index';
			} else if (cleanSource.startsWith(`${CORE_PACKAGE_ID}/`)) {
				rel = cleanSource.slice(CORE_PACKAGE_ID.length + 1);
			} else if (cleanSource.startsWith('.')) {
				if (!importer) {
					return done(null);
				}
				const importerFile = importer.split('?', 1)[0];
				const importerDir = importerFile.startsWith('/@fs/') ? path.dirname(importerFile.slice('/@fs'.length)) : path.dirname(importerFile);
				const target = normalizeModuleId(path.resolve(importerDir, cleanSource));
				if (!target.startsWith(`${coreRoot}/`)) {
					return done(null);
				}
				rel = target.slice(coreRoot.length + 1);
			} else if (path.isAbsolute(cleanSource)) {
				const normalized = normalizeModuleId(cleanSource);
				if (!normalized.startsWith(`${coreRoot}/`)) {
					return done(null);
				}
				rel = normalized.slice(coreRoot.length + 1);
			} else {
				return done(null);
			}

			// Normalize to the core module id: strip the script extension.
			rel = rel.replace(/\\/g, '/');
			rel = rel.replace(/\.(tsx|jsx|ts|js|mjs)$/, '');
			// An import that explicitly names a platform file — a built-in
			// suffix or one of the active platform's — already knows which file
			// it wants. Never rewrite it; normal resolution picks the file up.
			if (platformSuffixes.some((suffix) => rel.endsWith(suffix))) {
				return done(null);
			}
			if (!rel) {
				return done(null);
			}

			const importerFile = importer ? normalizeModuleId(importer.split('?', 1)[0]) : '';
			for (const id of moduleIdCandidates(rel)) {
				// 1. provider — skipped when the importer IS the provider file for
				//    this id, so provider modules can extend the core module they
				//    shadow instead of resolving to themselves.
				const candidates = providerCandidates(id);
				if (!candidates.includes(importerFile)) {
					const provided = findFirst(candidates);
					if (provided) {
						return done(normalizeModuleId(provided));
					}
				}
				// 2. reuse — an explicit mapping to an existing core platform file.
				const reuseSuffix = reuse[id];
				if (reuseSuffix) {
					const reused = findFirst(PROVIDER_EXTENSIONS.map((ext) => `${coreRoot}/${id}${reuseSuffix}${ext}`));
					if (reused) {
						return done(normalizeModuleId(reused));
					}
				}
				// 3. normal resolution — the core shared file (the platform's own
				//    suffixes inside coreRoot are still honored, matching
				//    resolve.extensions).
				const normal = findFirst(normalCandidates(id));
				if (normal) {
					return done(null);
				}
			}

			// 4. nothing resolved — say exactly what was checked.
			const checked = moduleIdCandidates(rel).flatMap((id) => [...providerCandidates(id), ...(reuse[id] ? PROVIDER_EXTENSIONS.map((ext) => `${coreRoot}/${id}${reuse[id]}${ext}`) : []), ...normalCandidates(id)]);
			const message = `@nativescript/core module "${rel}" has no implementation for platform "${platform?.name}". Checked:\n${checked.map((file) => `  - ${file}`).join('\n')}`;
			log(message);
			return done(this.error(message));
		},
	};
}
