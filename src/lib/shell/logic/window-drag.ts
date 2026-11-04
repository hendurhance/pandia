import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const CONTROLS =
	'button, input, select, textarea, a, [role="button"], [role="tab"], [data-tab-id], [data-no-drag]';

const OVERLAY_SCROLLBAR_PX = 10;

function onScrollbar(el: HTMLElement, e: PointerEvent): boolean {
	const zone = (bar: number) => (bar > 0 ? 0 : OVERLAY_SCROLLBAR_PX);
	const scrollsX = el.scrollWidth > el.clientWidth;
	const scrollsY = el.scrollHeight > el.clientHeight;
	const belowX = e.offsetY >= el.clientHeight - zone(el.offsetHeight - el.clientHeight);
	const besideY = e.offsetX >= el.clientWidth - zone(el.offsetWidth - el.clientWidth);
	return (scrollsX && belowX) || (scrollsY && besideY);
}

export function dragWindowFrom(e: PointerEvent): void {
	if (e.button !== 0) return;
	const target = e.target as HTMLElement | null;
	if (!target || target.closest(CONTROLS) || onScrollbar(target, e)) return;
	void getCurrentWebviewWindow()
		.startDragging()
		.catch(() => {});
}
