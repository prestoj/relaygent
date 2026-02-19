import { json } from '@sveltejs/kit';
import { addTask, removeTask } from '$lib/tasks.js';
import { getKbDir } from '$lib/kb.js';

export async function POST({ request }) {
	try {
		const { description } = await request.json();
		if (!description || typeof description !== 'string' || !description.trim()) {
			return json({ error: 'description required' }, { status: 400 });
		}
		const ok = addTask(getKbDir(), description.trim());
		return json({ ok });
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
}

export async function DELETE({ request }) {
	try {
		const { description } = await request.json();
		if (!description || typeof description !== 'string') {
			return json({ error: 'description required' }, { status: 400 });
		}
		const ok = removeTask(getKbDir(), description.trim());
		return json({ ok });
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
}
