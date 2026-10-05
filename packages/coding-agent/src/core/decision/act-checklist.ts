/** Extract markdown / unicode checkbox task lines from assistant text. */
export function extractCheckboxTodoItems(message: string): string[] {
	const items: string[] = [];
	for (const line of message.split("\n")) {
		const match = line.match(/^\s*(?:[-*]|\d+[.)])\s*\[([ xX])\]\s+(.+)$/);
		if (match) {
			const text = match[2].trim();
			if (text.length > 0) items.push(text);
			continue;
		}
		const unicode = line.match(/^\s*[☐☑✓✔]\s+(.+)$/);
		if (unicode) {
			const text = unicode[1].trim();
			if (text.length > 0) items.push(text);
		}
	}
	return items;
}

export function assistantTextHasCheckboxList(message: string): boolean {
	return extractCheckboxTodoItems(message).length > 0;
}
