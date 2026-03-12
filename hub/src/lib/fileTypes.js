/** File type detection utilities for the files page. */

const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
const TEXT_EXT = ['.md', '.txt', '.py', '.js', '.sh', '.json', '.yaml', '.yml', '.csv', '.toml'];
const VID_EXT = ['.mp4', '.webm', '.mov', '.mkv', '.avi'];
const AUD_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];

export function ext(name) { return name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : ''; }
export function isMd(name) { return ext(name) === '.md'; }
export function isImage(name) { return IMG_EXT.includes(ext(name)); }
export function isText(name) { return TEXT_EXT.includes(ext(name)); }
export function isVideo(name) { return VID_EXT.includes(ext(name)); }
export function isAudio(name) { return AUD_EXT.includes(ext(name)); }
export function typeOf(name) {
	return isVideo(name) ? 'video' : isAudio(name) ? 'audio' : isImage(name) ? 'image' : 'other';
}
