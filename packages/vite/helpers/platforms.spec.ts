import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { build } from 'vite';
import { builtinPlatforms, getPlatform, getPlatformExtensions, getPlatformBundleDefines, getPlatformDefineValues, platformProviderPlugin, type NativeScriptPlatform } from './platforms.js';
import { getGlobalDefines, getRuntimeDefineValues, getRuntimeSeedValues, buildGlobalSeedStatements, buildGuardedDefineSeedStatement, buildDefineShimStatements } from './global-defines.js';
// webpack5 ships the same tables for its DefinePlugin — assert parity so the
// two bundlers can never drift on built-in capability values.
import { platformCapabilities } from '../../webpack5/src/helpers/platform-capabilities.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = join(here, 'fixtures', 'platform-core');
const PROVIDER_ROOT = join(here, 'fixtures', 'platform-provider');

const testos: NativeScriptPlatform = {
	name: 'testos',
	family: 'apple',
	suffixes: ['.testos'],
	provider: { root: PROVIDER_ROOT },
	reuse: { 'timer/index': '.ios' },
	capabilities: {
		propertyChangesRequestLayout: true,
		textChangeAffectsLayout: true,
	},
};

// ── platform registry ────────────────────────────────────────────────────────

describe('getPlatform', () => {
	it('resolves built-ins by name', () => {
		expect(getPlatform('ios')).toBe(builtinPlatforms.ios);
		expect(getPlatform('android')).toBe(builtinPlatforms.android);
		expect(getPlatform('visionos')).toBe(builtinPlatforms.visionos);
	});

	it('resolves external platforms from the registered list', () => {
		expect(getPlatform('testos', [testos])).toBe(testos);
	});

	it('returns undefined for unknown or missing names', () => {
		expect(getPlatform(undefined)).toBeUndefined();
		expect(getPlatform('testos')).toBeUndefined();
		expect(getPlatform('windows', [testos])).toBeUndefined();
	});

	it('prefers built-ins over external registrations with the same name', () => {
		expect(getPlatform('ios', [testos, { ...testos, name: 'ios' }])).toBe(builtinPlatforms.ios);
	});
});

// ── extensions ───────────────────────────────────────────────────────────────

describe('getPlatformExtensions', () => {
	it('matches the pre-change lists for built-ins and the no-platform fallback', () => {
		expect(getPlatformExtensions(builtinPlatforms.ios)).toEqual(['.ios.tsx', '.tsx', '.ios.jsx', '.jsx', '.ios.ts', '.ts', '.ios.js', '.js', '.mjs', '.json']);
		expect(getPlatformExtensions(builtinPlatforms.android)).toEqual(['.android.tsx', '.tsx', '.android.jsx', '.jsx', '.android.ts', '.ts', '.android.js', '.js', '.mjs', '.json']);
		// visionOS keeps resolving through the iOS file set
		expect(getPlatformExtensions(builtinPlatforms.visionos)).toEqual(getPlatformExtensions(builtinPlatforms.ios));
		expect(getPlatformExtensions(undefined)).toEqual(['.tsx', '.jsx', '.ts', '.js', '.mjs', '.json']);
	});

	it('interleaves each external suffix before its plain extension', () => {
		expect(getPlatformExtensions(testos)).toEqual(['.testos.tsx', '.tsx', '.testos.jsx', '.jsx', '.testos.ts', '.ts', '.testos.js', '.js', '.mjs', '.json']);
	});
});

// ── define values ────────────────────────────────────────────────────────────

describe('getPlatformDefineValues', () => {
	it('maps built-ins to the historical expressions', () => {
		expect(getPlatformDefineValues(builtinPlatforms.ios)).toMatchObject({ __ANDROID__: false, __IOS__: true, __VISIONOS__: false, __APPLE__: true });
		expect(getPlatformDefineValues(builtinPlatforms.visionos)).toMatchObject({ __ANDROID__: false, __IOS__: false, __VISIONOS__: true, __APPLE__: true });
		expect(getPlatformDefineValues(builtinPlatforms.android)).toMatchObject({ __ANDROID__: true, __IOS__: false, __VISIONOS__: false, __APPLE__: false });
	});

	it('gives an apple-family external platform __APPLE__ without __IOS__', () => {
		expect(getPlatformDefineValues(testos)).toMatchObject({ __ANDROID__: false, __IOS__: false, __VISIONOS__: false, __APPLE__: true });
		expect(getPlatformDefineValues(testos).capabilities).toBe(testos.capabilities);
	});
});

describe('capabilities in defines and seeds', () => {
	const defines = getGlobalDefines({ platform: 'testos', platforms: [testos], targetMode: 'production', verbose: false, flavor: 'typescript' }) as Record<string, unknown>;

	it('emits one dotted define per capability', () => {
		expect(defines['__NS_CAP__.propertyChangesRequestLayout']).toBe('true');
		expect(defines['__NS_CAP__.textChangeAffectsLayout']).toBe('true');
	});

	it('emits the bare object too', () => {
		expect(JSON.parse(defines.__NS_CAP__ as string)).toEqual(testos.capabilities);
	});

	it('seeds globalThis.__NS_CAP__ in the bundle seed statements', () => {
		const statements = buildGlobalSeedStatements(getRuntimeSeedValues({ platform: 'testos', platforms: [testos], isDevMode: false, verbose: false, flavor: 'typescript' }));
		expect(statements).toContain(`globalThis.__NS_CAP__ = ${JSON.stringify(testos.capabilities)};`);
	});

	it('shims __NS_CAP__ per-module for raw-served code', () => {
		const shims = buildDefineShimStatements(getRuntimeDefineValues({ platform: 'testos', platforms: [testos], isDevMode: false, verbose: false }));
		expect(shims.some((s) => s.startsWith('const __NS_CAP__ = '))).toBe(true);
	});
});

// ── isIOS ────────────────────────────────────────────────────────────────────

describe('isIOS', () => {
	it('is __IOS__ || __VISIONOS__ for built-ins (same values as before)', () => {
		expect(getRuntimeSeedValues({ platform: 'ios', isDevMode: false, verbose: false, flavor: 'typescript' }).isIOS).toBe(true);
		expect(getRuntimeSeedValues({ platform: 'visionos', isDevMode: false, verbose: false, flavor: 'typescript' }).isIOS).toBe(true);
		expect(getRuntimeSeedValues({ platform: 'android', isDevMode: false, verbose: false, flavor: 'typescript' }).isIOS).toBe(false);
		expect(getGlobalDefines({ platform: 'ios', targetMode: 'production', verbose: false, flavor: 'typescript' })['global.isIOS']).toBe('true');
		expect(getGlobalDefines({ platform: 'visionos', targetMode: 'production', verbose: false, flavor: 'typescript' })['global.isIOS']).toBe('true');
	});

	it('is false for an apple-family external platform', () => {
		expect(getRuntimeSeedValues({ platform: 'testos', platforms: [testos], isDevMode: false, verbose: false, flavor: 'typescript' }).isIOS).toBe(false);
		expect(getGlobalDefines({ platform: 'testos', platforms: [testos], targetMode: 'production', verbose: false, flavor: 'typescript' })['global.isIOS']).toBe('false');
	});
});

// ── baseline equality: built-in output must be identical ─────────────────────

describe('built-in output equals pre-change baseline', () => {
	const baseline = JSON.parse(readFileSync(join(here, 'platforms-baseline.json'), 'utf8'));

	// __NS_CAP__ keys are new by design; strip them so the comparison is over
	// the keys that existed before this change.
	const stripCaps = (obj: Record<string, unknown>) => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('__NS_CAP__')));

	for (const platform of ['ios', 'android', 'visionos', 'undefined'] as const) {
		const name = platform === 'undefined' ? undefined : (platform as 'ios' | 'android' | 'visionos');
		const expected = baseline[platform];

		it(`runtime define values — ${platform}`, () => {
			expect(stripCaps(getRuntimeDefineValues({ platform: name, isDevMode: false, verbose: false }) as unknown as Record<string, unknown>)).toEqual(expected.runtime);
		});

		it(`global defines — ${platform}`, () => {
			const defines = getGlobalDefines({ platform: name as any, targetMode: 'production', verbose: false, flavor: 'typescript', isCI: false }) as Record<string, unknown>;
			delete defines.__NS_APP_ROOT_DIR__;
			delete defines.__NS_APP_ROOT_VIRTUAL__;
			expect(stripCaps(defines)).toEqual(expected.defines);
		});

		it(`seed values + statements — ${platform}`, () => {
			const seed = getRuntimeSeedValues({ platform: name, isDevMode: false, verbose: false, flavor: 'typescript', isCI: false });
			delete seed.__NS_APP_ROOT_DIR__;
			delete seed.__NS_APP_ROOT_VIRTUAL__;
			delete seed.__NS_HMR_PROGRESS_OVERLAY_ENABLED__;
			expect(stripCaps(seed as Record<string, unknown>)).toEqual(expected.seed);
			const statements = buildGlobalSeedStatements(seed).filter((s) => !s.startsWith('globalThis.__NS_CAP__'));
			expect(statements).toEqual(expected.seedStatements);
		});

		it(`guarded seed + shim statements — ${platform}`, () => {
			const runtime = getRuntimeDefineValues({ platform: name, isDevMode: false, verbose: false });
			expect(buildGuardedDefineSeedStatement(runtime).replace(/\nif \(globalThis\.__NS_CAP__.*$/, '')).toBe(expected.guardedSeed);
			expect(buildDefineShimStatements(runtime).filter((s) => !s.startsWith('const __NS_CAP__'))).toEqual(expected.shimStatements);
		});
	}
});

// ── platformProviderPlugin resolution ────────────────────────────────────────

const resolveWith = (source: string, importer?: string) => {
	const plugin = platformProviderPlugin({ platform: testos, coreRoot: CORE_ROOT });
	const resolveId = plugin.resolveId as (this: { error: (msg: string) => never }, source: string, importer?: string) => string | null;
	return resolveId.call(
		{
			error: (msg: string) => {
				throw new Error(msg);
			},
		},
		source,
		importer,
	);
};

describe('platformProviderPlugin', () => {
	it('resolves a bare core specifier to the provider file (step 1)', () => {
		expect(resolveWith('@nativescript/core/ui/label')).toBe(join(PROVIDER_ROOT, 'ui/label/index.testos.ts'));
	});

	it('resolves a relative import inside the core root to the provider file', () => {
		expect(resolveWith('./index', join(CORE_ROOT, 'ui/label/index.ts'))).toBe(join(PROVIDER_ROOT, 'ui/label/index.testos.ts'));
	});

	it('resolves through the reuse map when the provider misses (step 2)', () => {
		expect(resolveWith('@nativescript/core/timer')).toBe(join(CORE_ROOT, 'timer/index.ios.ts'));
	});

	it('returns null for normal resolution when the core shared file exists (step 3)', () => {
		expect(resolveWith('@nativescript/core/globals')).toBeNull();
	});

	it('skips the provider when the importer IS the provider file for that id', () => {
		const providerFile = join(PROVIDER_ROOT, 'extended/index.testos.ts');
		// provider file imports the core module it shadows → step 1 skipped,
		// normal resolution finds the core shared file → null for Vite.
		expect(resolveWith('@nativescript/core/extended', providerFile)).toBeNull();
	});

	it('throws a descriptive error when nothing resolves (step 4)', () => {
		expect(() => resolveWith('@nativescript/core/no-such-module')).toThrowError(/@nativescript\/core module "no-such-module" has no implementation for platform "testos"[\s\S]*provider[\s\S]*core/);
	});

	it('does not intercept imports outside the core root', () => {
		expect(resolveWith('./sibling', join(here, 'platforms.ts'))).toBeNull();
		expect(resolveWith('lodash')).toBeNull();
	});

	it('never rewrites an import that explicitly names a platform file', () => {
		// A core file importing its platform sibling means that file — the
		// suffix is part of the specifier, not a resolution hint.
		expect(resolveWith('./dep.ios', join(CORE_ROOT, 'shared/index.ts'))).toBeNull();
		expect(resolveWith('./dep.ios.ts', join(CORE_ROOT, 'shared/index.ts'))).toBeNull();
		expect(resolveWith('@nativescript/core/timer/index.ios', join(CORE_ROOT, 'x.ts'))).toBeNull();
		expect(resolveWith('@nativescript/core/timer/index.ios.ts')).toBeNull();
		// The active platform's own suffix gets the same treatment.
		expect(resolveWith('./index.testos.ts', join(CORE_ROOT, 'ui/label/index.ts'))).toBeNull();
	});

	it('passes non-script imports through without resolving or erroring', () => {
		expect(resolveWith('@nativescript/core/ui/label/styles.css', join(CORE_ROOT, 'ui/label/index.ts'))).toBeNull();
		expect(resolveWith('./data.json', join(CORE_ROOT, 'globals/index.ts'))).toBeNull();
		expect(resolveWith('./page.xml', join(CORE_ROOT, 'ui/label/index.ts'))).toBeNull();
		// Even a nonexistent non-script file inside core is not our error.
		expect(resolveWith('@nativescript/core/i-dont-exist.css')).toBeNull();
	});

	it('no-ops for platforms without provider or reuse', () => {
		const plugin = platformProviderPlugin({ platform: builtinPlatforms.ios, coreRoot: CORE_ROOT });
		const resolveId = plugin.resolveId as (source: string, importer?: string) => string | null;
		expect(resolveId.call({ error: (m: string) => m }, '@nativescript/core/ui/label', join(CORE_ROOT, 'ui/x.ts'))).toBeNull();
	});
});

// ── getPlatformBundleDefines ─────────────────────────────────────────────────

describe('getPlatformBundleDefines', () => {
	it('emits the platform flags, capability defines, and legacy is* members', () => {
		expect(getPlatformBundleDefines(testos)).toEqual({
			__ANDROID__: 'false',
			__IOS__: 'false',
			__VISIONOS__: 'false',
			__APPLE__: 'true',
			'__NS_CAP__.propertyChangesRequestLayout': 'true',
			'__NS_CAP__.textChangeAffectsLayout': 'true',
			__NS_CAP__: JSON.stringify(testos.capabilities),
			'global.isAndroid': 'false',
			'global.isIOS': 'false',
		});
	});

	it('matches the built-in expressions (isIOS includes visionos)', () => {
		expect(getPlatformBundleDefines(builtinPlatforms.visionos)).toMatchObject({ __VISIONOS__: 'true', __APPLE__: 'true', 'global.isIOS': 'true' });
		expect(getPlatformBundleDefines(undefined)['global.isIOS']).toBe('false');
	});
});

// ── webpack5 capability parity ───────────────────────────────────────────────

describe('webpack5 capability parity', () => {
	it('platformCapabilities matches the built-in descriptors', () => {
		for (const name of ['ios', 'android', 'visionos'] as const) {
			expect(platformCapabilities[name]).toEqual(builtinPlatforms[name].capabilities);
		}
	});
});

// ── end-to-end: a real Vite build resolves the provider tree ─────────────────

describe('platformProviderPlugin under a real Vite build', () => {
	const APP_ROOT = join(here, 'fixtures', 'build-app');

	// build.lib is the reliable programmatic path under rolldown-vite: a bare
	// rollupOptions.input + format build emits an empty chunk here.
	const buildApp = async (entry: string) => {
		const outDir = mkdtempSync(join(tmpdir(), 'ns-platform-build-'));
		await build({
			root: APP_ROOT,
			configFile: false,
			logLevel: 'silent',
			plugins: [platformProviderPlugin({ platform: testos, coreRoot: CORE_ROOT })],
			resolve: {
				alias: [{ find: '@nativescript/core', replacement: CORE_ROOT }],
				extensions: getPlatformExtensions(testos),
			},
			define: getPlatformBundleDefines(testos),
			optimizeDeps: { noDiscovery: true, include: [] },
			build: {
				outDir,
				emptyOutDir: true,
				minify: false,
				target: 'esnext',
				lib: { entry: join(APP_ROOT, entry), formats: ['es'], fileName: 'entry' },
			},
		});
		return (readdirSync(outDir, { recursive: true }) as string[])
			.filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))
			.map((f) => readFileSync(join(outDir, f), 'utf8'))
			.join('\n');
	};

	it('bundles provider, reuse, shared, and self-referencing modules with substituted defines', async () => {
		const code = await buildApp('entry.ts');

		// Provider-shadowed module, reuse-mapped module, shared module whose
		// relative import inside core hit the provider, and a provider module
		// extending the core module it shadows — all present.
		expect(code).toContain('PROVIDER_LABEL');
		expect(code).toContain('CORE_TIMER_IOS');
		expect(code).toContain('CORE_GLOBALS');
		expect(code).toContain('PROVIDER_DEP');
		expect(code).toContain('CORE_EXTENDED');
		expect(code).toContain('PROVIDER_EXTENDED');

		// The capability define substituted to a constant — no __NS_CAP__
		// identifier may survive into the bundle.
		expect(code).not.toContain('__NS_CAP__');
		expect(code).toMatch(/capValue\s*=\s*true/);
	});

	it('rejects the build when a module has no implementation for the platform', async () => {
		await expect(buildApp('entry-missing.ts')).rejects.toThrowError(/@nativescript\/core module "no-such-module" has no implementation for platform "testos"/);
	});
});
