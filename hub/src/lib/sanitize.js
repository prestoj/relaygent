import DOMPurify from 'isomorphic-dompurify';

/** Sanitize HTML to prevent XSS. Allows markdown-generated tags. */
export function sanitizeHtml(html) {
	if (!html) return '';
	return DOMPurify.sanitize(html);
}
