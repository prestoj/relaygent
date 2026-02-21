import { redirect } from '@sveltejs/kit';
import { COOKIE_NAME } from '$lib/auth.js';

export async function POST({ cookies }) {
	cookies.delete(COOKIE_NAME, { path: '/' });
	throw redirect(302, '/login');
}
