import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
export default {
	kit: {
		// out is env-configurable so the deploy script can build into a staging dir
		// (build.staging) and atomically swap it into place — the live `build/` is
		// never half-written, killing the rebuild race that served broken chunks.
		adapter: adapter({ out: process.env.HUB_BUILD_OUT || 'build' }),
		csrf: {
			// Hub is internal-only (local network), not exposed to public internet.
			// Non-localhost origins don't match the server's origin, triggering
			// SvelteKit's built-in CSRF protection. Safe to disable for internal tool.
			checkOrigin: false,
		},
	}
};
