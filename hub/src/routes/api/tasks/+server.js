import { json } from '@sveltejs/kit';
import { loadTasks, addTask, removeTask, editTask, completeTask } from '$lib/tasks.js';
import { getKbDir } from '$lib/kb.js';

export function GET() {
	const { tasks } = loadTasks(getKbDir());
	const now = new Date();
	const recurring = tasks
		.filter(t => t.type === 'recurring')
		.sort((a, b) => {
			if (a.due !== b.due) return a.due ? -1 : 1;
			const ta = a.nextDue ? new Date(a.nextDue).getTime() : Infinity;
			const tb = b.nextDue ? new Date(b.nextDue).getTime() : Infinity;
			return ta - tb;
		});
	const oneoff = tasks.filter(t => t.type !== 'recurring');
	return json({ recurring, oneoff, now: now.toISOString() });
}

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

export async function PATCH({ request }) {
	try {
		const { oldDescription, newDescription } = await request.json();
		if (!oldDescription || !newDescription || typeof oldDescription !== 'string' || typeof newDescription !== 'string') {
			return json({ error: 'oldDescription and newDescription required' }, { status: 400 });
		}
		const ok = editTask(getKbDir(), oldDescription.trim(), newDescription.trim());
		return json({ ok });
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
}

export async function PUT({ request }) {
	try {
		const { description } = await request.json();
		if (!description || typeof description !== 'string') {
			return json({ error: 'description required' }, { status: 400 });
		}
		const ok = completeTask(getKbDir(), description.trim());
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
