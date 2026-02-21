import { redirect, fail } from '@sveltejs/kit';
import { checkPassword, createSession, validateSession, isAuthEnabled, COOKIE_NAME, SESSION_MAX_AGE } from '$lib/auth.js';

export function load({ cookies }) {
	if (!isAuthEnabled()) throw redirect(302, '/');
	if (validateSession(cookies.get(COOKIE_NAME))) throw redirect(302, '/');
	return {};
}

export const actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const password = form.get('password')?.toString() || '';
		if (!checkPassword(password)) return fail(401, { incorrect: true });
		cookies.set(COOKIE_NAME, createSession(), {
			path: '/', httpOnly: true, sameSite: 'lax',
			maxAge: SESSION_MAX_AGE, secure: false,
		});
		throw redirect(302, '/');
	},
};
