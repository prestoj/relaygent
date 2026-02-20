import { getTopic, saveTopic, deleteTopic, getKbDir } from '$lib/kb.js';
import { error, redirect } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const KB_DIR = getKbDir();

function validateSlug(slug) {
	const filepath = path.join(KB_DIR, `${slug}.md`);
	const resolved = path.resolve(filepath);
	if (!resolved.startsWith(path.resolve(KB_DIR))) {
		throw error(400, 'Invalid slug');
	}
	return filepath;
}

export function load({ params }) {
	validateSlug(params.slug);
	const topic = getTopic(params.slug);

	// Topic doesn't exist yet — show creation UI instead of 404
	if (!topic) return { topic: null, rawContent: '', slug: params.slug };

	const raw = fs.readFileSync(path.join(KB_DIR, `${params.slug}.md`), 'utf-8');
	const { content } = matter(raw);
	return { topic, rawContent: content, slug: params.slug };
}

export const actions = {
	save: async ({ params, request }) => {
		const filepath = validateSlug(params.slug);
		const formData = await request.formData();
		const content = formData.get('content') ?? '';
		const title = formData.get('title') || params.slug;

		let frontmatter = { title, created: new Date().toISOString().split('T')[0] };
		if (fs.existsSync(filepath)) {
			const { data } = matter(fs.readFileSync(filepath, 'utf-8'));
			frontmatter = { ...data };
			if (formData.get('title')) frontmatter.title = title;
		}

		saveTopic(params.slug, frontmatter, content);
		return { success: true };
	},

	delete: async ({ params }) => {
		validateSlug(params.slug);
		try { deleteTopic(params.slug); } catch { throw error(404, 'Topic not found'); }
		throw redirect(303, '/kb');
	}
};
