/** Audio chime + desktop notification helpers for ChatBubble */

let audioCtx = null;

export function initAudio() {
	if (audioCtx) return;
	try {
		audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		if (audioCtx.state === 'suspended') audioCtx.resume();
	} catch {}
	document.removeEventListener('click', initAudio);
	document.removeEventListener('keydown', initAudio);
	if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
		Notification.requestPermission();
	}
}

export function playChime() {
	try {
		initAudio();
		if (!audioCtx || audioCtx.state === 'suspended') return;
		const now = audioCtx.currentTime;
		[659.25, 783.99].forEach((freq, i) => {
			const osc = audioCtx.createOscillator();
			const gain = audioCtx.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.15, now + i * 0.12);
			gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.4);
			osc.connect(gain);
			gain.connect(audioCtx.destination);
			osc.start(now + i * 0.12);
			osc.stop(now + i * 0.12 + 0.4);
		});
	} catch {}
}

export function notifyDesktop(text) {
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
	try {
		new Notification('Relaygent', { body: (text || '').substring(0, 120), icon: '/favicon.svg' });
	} catch {}
}
