<script lang="ts">
	let { name, size = 16, class: class_ = '' }: { name: string; size?: number; class?: string } = $props();
	
	const icons: Record<string, string> = {
		// File operations
		'file-new': `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
		<polyline points="14,2 14,8 20,8"/>
		<line x1="12" y1="11" x2="12" y2="17"/>
		<line x1="9" y1="14" x2="15" y2="14"/>`,
		'file-open': `<path d="m23.596,11.827c-.391-.525-.993-.827-1.652-.827h-.943v-3.5c0-2.481-2.019-4.5-4.5-4.5h-6.056c-.232,0-.464-.055-.671-.158l-3.155-1.578c-.345-.172-.731-.264-1.118-.264h-2C1.57,1,0,2.57,0,4.5v14c0,2.481,2.019,4.5,4.5,4.5h13.558c2.003,0,3.735-1.289,4.317-3.229l1.537-6.138c.188-.626.072-1.285-.316-1.807ZM1,18.5V4.5c0-1.378,1.121-2.5,2.5-2.5h2c.232,0,.464.055.671.158l3.155,1.578c.345.172.731.264,1.118.264h6.056c1.93,0,3.5,1.57,3.5,3.5v3.5h-11.885c-1.49,0-2.818.938-3.311,2.354l-2.433,7.924c-.834-.64-1.372-1.647-1.372-2.777Zm21.948-5.132l-1.537,6.138c-.448,1.492-1.796,2.494-3.354,2.494H4.5c-.435,0-.851-.08-1.234-.225l2.489-8.111c.347-.996,1.295-1.665,2.36-1.665h13.828c.34,0,.649.154.851.424.198.266.257.603.154.944Z" style="stroke-width:1.2;"/>`,
		'file-save': `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/>`,
		'file-code': `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
		<polyline points="14,2 14,8 20,8"/>
		<path d="m10 13-2 2 2 2"/>
		<path d="m14 17 2-2-2-2"/>`,
		'file': `<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>`,
		'folder': `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`,
		'folder-open': `<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-3.25 7a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.6a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>`,
		'link': `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
		'upload': `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
		'import': `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
		
		// Editor operations
		'format': `<path d="M4 7V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/>
		<polyline points="4,15 8,11 4,7"/>
		<line x1="10" y1="11" x2="14" y2="15"/>`,
		'compress': `<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>`,
		'validate': `<polyline points="20,6 9,17 4,12"/>`,
		'compare': `<path d="M9 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3m5-11h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3"/>
		<line x1="14" y1="3" x2="14" y2="21"/>
		<polyline points="11,6 14,3 17,6"/>
		<polyline points="17,18 14,21 11,18"/>`,
		'transform': `<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5c-1.1 0-2-.9-2-2V8a2 2 0 0 1 2-2h3V4z"/>
		<polyline points="6,9 10,9"/>
		<line x1="7" y1="5" x2="7" y2="13"/>
		<polyline points="6,13 10,13"/>`,
		'visualize': `<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M22 12h-10V2"/>`,
		'export': `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
		
		// Navigation
		'search': `<circle cx="11" cy="11" r="8"/>
		<path d="m21 21-4.35-4.35"/>`,
		'query': `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
		<line x1="9" y1="9" x2="21" y2="9"/>
		<line x1="9" y1="15" x2="21" y2="15"/>
		<circle cx="6.5" cy="9" r="1.5"/>
		<circle cx="6.5" cy="15" r="1.5"/>`,
		'filter': `<polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/>`,
	   'find-replace': `<circle cx="12" cy="12" r="3"/><path d="M19 12A7 7 0 0 1 12 19M5 12A7 7 0 0 1 12 5"/><path d="M21 12h-6m0 0 2.5 2.5M15 12l2.5-2.5"/>`,
		'schema': `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
		<polyline points="14,2 14,8 20,8"/>
		<line x1="16" y1="13" x2="8" y2="13"/>
		<line x1="16" y1="17" x2="8" y2="17"/>
		<polyline points="10,9 9,9 8,9"/>`,
		'shortcuts': `<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
		<line x1="8" y1="21" x2="16" y2="21"/>
		<line x1="12" y1="17" x2="12" y2="21"/>`,
		'autosave': `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
		<polyline points="17,21 17,13 7,13 7,21"/>
		<polyline points="7,3 7,8 15,8"/>
		<circle cx="12" cy="17" r="1"/>`,
		
		// UI Controls
		'close': `<line x1="18" y1="6" x2="6" y2="18"/>
		<line x1="6" y1="6" x2="18" y2="18"/>`,
		'minimize': `<line x1="8" y1="12" x2="16" y2="12"/>`,
		'maximize': `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>`,
		'restore': `<rect x="5" y="9" width="12" height="12" rx="1" ry="1"/>
		<path d="M9 9V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3"/>`,
		'settings': `<circle cx="12" cy="12" r="3"/>
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
		'info': `<circle cx="12" cy="12" r="10"/>
		<line x1="12" y1="16" x2="12" y2="12"/>
		<line x1="12" y1="8" x2="12.01" y2="8"/>`,
		'x': `<line x1="18" y1="6" x2="6" y2="18"/>
		<line x1="6" y1="6" x2="18" y2="18"/>`,
		
		// Status indicators
		'success': `<polyline points="20,6 9,17 4,12"/>`,
		'check-circle': `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
		<polyline points="22 4 12 14.01 9 11.01"/>`,
		'warning': `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
		<line x1="12" y1="9" x2="12" y2="13"/>
		<line x1="12" y1="17" x2="12.01" y2="17"/>`,
		'error': `<circle cx="12" cy="12" r="10"/>
		<line x1="15" y1="9" x2="9" y2="15"/>
		<line x1="9" y1="9" x2="15" y2="15"/>`,
		
		// Editor modes
		'tree-view': `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
		<circle cx="12" cy="10" r="3"/>`,
		'code-view': `<polyline points="16,18 22,12 16,6"/>
		<polyline points="8,6 2,12 8,18"/>`,
		'form-view': `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
		<polyline points="14,2 14,8 20,8"/>
		<line x1="16" y1="13" x2="8" y2="13"/>
		<line x1="16" y1="17" x2="8" y2="17"/>
		<polyline points="10,9 9,9 8,9"/>`,
		'table-view': `<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>`,
		'text-view': `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
		<polyline points="14,2 14,8 20,8"/>
		<line x1="16" y1="13" x2="8" y2="13"/>
		<line x1="16" y1="17" x2="8" y2="17"/>`,
		'readonly-view': `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
		<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`,
		
		// Tabs
		'tab-close': `<line x1="18" y1="6" x2="6" y2="18"/>
		<line x1="6" y1="6" x2="18" y2="18"/>`,
		'tab-dirty': `<circle cx="12" cy="12" r="2"/>`,
		
		// Navigation arrows
		'chevron-left': `<polyline points="15,18 9,12 15,6"/>`,
		'chevron-right': `<polyline points="9,6 15,12 9,18"/>`,
		'chevron-down': `<polyline points="6,9 12,15 18,9"/>`,
		'chevron-up': `<polyline points="18,15 12,9 6,15"/>`,
		
		// Theme icons
		'theme-light': `<circle cx="12" cy="12" r="5"/>
		<line x1="12" y1="1" x2="12" y2="3"/>
		<line x1="12" y1="21" x2="12" y2="23"/>
		<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
		<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
		<line x1="1" y1="12" x2="3" y2="12"/>
		<line x1="21" y1="12" x2="23" y2="12"/>
		<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
		<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`,
		'theme-dark': `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
		'theme-auto': `<circle cx="12" cy="12" r="5"/>
		<line x1="12" y1="1" x2="12" y2="3"/>
		<line x1="12" y1="21" x2="12" y2="23"/>
		<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
		<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
		<line x1="1" y1="12" x2="3" y2="12"/>
		<line x1="21" y1="12" x2="23" y2="12"/>
		<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
		<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
		<path d="M12 7v10"/>`,
		
		// Sidebar
		'sidebar': `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
		<line x1="9" y1="9" x2="21" y2="9"/>
		<line x1="9" y1="15" x2="21" y2="15"/>
		<line x1="3" y1="9" x2="7" y2="9"/>
		<line x1="3" y1="15" x2="7" y2="15"/>`,
		'menu': `<line x1="3" y1="6" x2="21" y2="6"/>
		<line x1="3" y1="12" x2="21" y2="12"/>
		<line x1="3" y1="18" x2="21" y2="18"/>`,
		
		// JSON specific
		'json': `<path d="M5 12.5c0 .8-.7 1.5-1.5 1.5S2 13.3 2 12.5s.7-1.5 1.5-1.5S5 11.7 5 12.5zm17 0c0 .8-.7 1.5-1.5 1.5s-1.5-.7-1.5-1.5.7-1.5 1.5-1.5 1.5.7 1.5 1.5z"/>
		<path d="M6 3v18M18 3v18M12 3v18"/>`,
		'repair': `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`,
		
		// Loading
		'loading': `<line x1="12" y1="2" x2="12" y2="6"/>
		<line x1="12" y1="18" x2="12" y2="22"/>
		<line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
		<line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
		<line x1="2" y1="12" x2="6" y2="12"/>
		<line x1="18" y1="12" x2="22" y2="12"/>
		<line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
		<line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>`,
		
		// Undo/Redo
		'undo': `<path d="M1 4v6h6"/>
		<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`,
		'redo': `<path d="M23 4v6h-6"/>
		<path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>`,
		
		// Additional transformation icons
		'sort': `<path d="M3 6h18"/>
		<path d="M6 12h12"/>
		<path d="M9 18h6"/>`,
		'flatten': `<path d="M3 12h18m-9-9v18"/>`,
		'expand': `<path d="M8 18L12 14L16 18M8 6L12 10L16 6"/>`,
		'clipboard': `<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
		<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>`,
		'loader': `<line x1="12" y1="2" x2="12" y2="6"/>
		<line x1="12" y1="18" x2="12" y2="22"/>
		<line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
		<line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
		<line x1="2" y1="12" x2="6" y2="12"/>
		<line x1="18" y1="12" x2="22" y2="12"/>
		<line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
		<line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>`,
		'download': `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
		<polyline points="7,10 12,15 17,10"/>
		<line x1="12" y1="15" x2="12" y2="3"/>`,
		'history': `<circle cx="12" cy="12" r="10"/>
		<polyline points="12,6 12,12 16,14"/>`,
		'lock': `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
		<circle cx="12" cy="7" r="4"/>
		<path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
		'unlock': `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
		<circle cx="12" cy="7" r="4"/>
		<path d="M7 11V7a5 5 0 0 1 9.9-1"/>`,
		'eye-off': `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
		<line x1="1" y1="1" x2="23" y2="23"/>`,
		'play': `<polygon points="5,3 19,12 5,21"/>`,
		'plus': `<line x1="12" y1="5" x2="12" y2="19"/>
		<line x1="5" y1="12" x2="19" y2="12"/>`,
		'hash': `<line x1="4" y1="9" x2="20" y2="9"/>
		<line x1="4" y1="15" x2="20" y2="15"/>
		<line x1="10" y1="3" x2="8" y2="21"/>
		<line x1="16" y1="3" x2="14" y2="21"/>`,
		'eye': `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
		<circle cx="12" cy="12" r="3"/>`,
		'sort-lines': `<path d="M11 5h10"/>
		<path d="M11 9h7"/>
		<path d="M11 13h4"/>
		<path d="M3 17l3 3 3-3"/>
		<path d="M6 18V4"/>`,
		'tree': `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
		<circle cx="12" cy="10" r="3"/>`,
		'package': `<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>
		<line x1="21" y1="16" x2="12" y2="9"/>
		<line x1="3" y1="16" x2="12" y2="9"/>
		<path d="M21 16V8a2 2 0 0 0-1-1.73L13 2a2 2 0 0 0-2 0L4 6.27A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73L11 22a2 2 0 0 0 2 0l7-4.27A2 2 0 0 0 21 16z"/>`,
		
		// Batch and Plugin icons
		'layers': `<polygon points="12,2 2,7 12,12 22,7 12,2"/>
		<polyline points="2,17 12,22 22,17"/>
		<polyline points="2,12 12,17 22,12"/>`,
		'batch': `<rect x="3" y="3" width="5" height="5" rx="1"/>
		<rect x="10" y="3" width="5" height="5" rx="1"/>
		<rect x="17" y="3" width="4" height="5" rx="1"/>
		<rect x="3" y="10" width="5" height="5" rx="1"/>
		<rect x="10" y="10" width="5" height="5" rx="1"/>
		<rect x="17" y="10" width="4" height="5" rx="1"/>
		<rect x="3" y="17" width="5" height="4" rx="1"/>
		<rect x="10" y="17" width="5" height="4" rx="1"/>
		<rect x="17" y="17" width="4" height="4" rx="1"/>`,
		'puzzle-piece': `<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.77 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"/>
		<circle cx="12" cy="12" r="3"/>`,
		'plugin': `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
		<circle cx="12" cy="12" r="1"/>
		<path d="M12 7v10M7 12h10"/>`,
		'dashboard': `<rect x="3" y="3" width="7" height="9" rx="1"/>
		<rect x="14" y="3" width="7" height="5" rx="1"/>
		<rect x="14" y="12" width="7" height="9" rx="1"/>
		<rect x="3" y="16" width="7" height="5" rx="1"/>`,
		'collapse': `<polyline points="15,18 9,12 15,6"/>`,
		'expand-sidebar': `<polyline points="9,6 15,12 9,18"/>`,
		'shield': `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
		<path d="M9 12l2 2 4-4"/>`,
		
		// Enhanced visualization icons
		'refresh': `<polyline points="23,4 23,10 17,10"/>
		<polyline points="1,20 1,14 7,14"/>
		<path d="M20.49,9A9,9,0,0,0,5.64,5.64L1,10"/>
		<path d="M3.51,15A9,9,0,0,1,18.36,18.36L23,14"/>`,
		'target': `<circle cx="12" cy="12" r="10"/>
		<circle cx="12" cy="12" r="6"/>
		<circle cx="12" cy="12" r="2"/>`,
		'code': `<polyline points="16,18 22,12 16,6"/>
		<polyline points="8,6 2,12 8,18"/>`,
		'camera': `<path d="M23,19a2,2,0,0,1-2,2H3a2,2,0,0,1-2-2V8A2,2,0,0,1,3,6H7L9,3h6l2,3h4a2,2,0,0,1,2,2Z"/>
		<circle cx="12" cy="13" r="4"/>`,
		'image': `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
		<circle cx="9" cy="9" r="2"/>
		<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`,
		'layout-vertical': `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
		<line x1="12" y1="3" x2="12" y2="21"/>`,
		'layout-horizontal': `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
		<line x1="3" y1="12" x2="21" y2="12"/>`,
		'lightbulb': `<path d="M9 21c0 .5.4 1 1 1h4c.6 0 1-.4 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17h8v-2.3c1.8-1.2 3-3.3 3-5.7 0-3.9-3.1-7-7-7z"/>`,
		'help': `<circle cx="12" cy="12" r="10"/>
		<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
		<line x1="12" y1="17" x2="12.01" y2="17"/>`,
		'clock': `<circle cx="12" cy="12" r="10"/>
		<polyline points="12,6 12,12 16,14"/>`,
		'trash': `<polyline points="3 6 5 6 21 6"></polyline>
		<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`,
		'edit': `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
		<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>`,
		'drag': `<circle cx="9" cy="12" r="1"/>
		<circle cx="9" cy="5" r="1"/>
		<circle cx="9" cy="19" r="1"/>
		<circle cx="15" cy="12" r="1"/>
		<circle cx="15" cy="5" r="1"/>
		<circle cx="15" cy="19" r="1"/>`,
		'database': `<ellipse cx="12" cy="5" rx="9" ry="3"/>
		<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
		<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>`,
		'copy': `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
		'move': `<polyline points="5,9 2,12 5,15"/>
		<polyline points="9,5 12,2 15,5"/>
		<polyline points="15,19 12,22 9,19"/>
		<polyline points="19,9 22,12 19,15"/>
		<line x1="2" y1="12" x2="22" y2="12"/>
		<line x1="12" y1="2" x2="12" y2="22"/>`,
		'zoom-in': `<circle cx="11" cy="11" r="8"/>
		<line x1="21" y1="21" x2="16.65" y2="16.65"/>
		<line x1="11" y1="8" x2="11" y2="14"/>
		<line x1="8" y1="11" x2="14" y2="11"/>`,
		'mouse-pointer': `<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
		<path d="M13 13l6 6"/>`,
		'terminal': `<polyline points="4 17 10 11 4 5"/>
		<line x1="12" y1="19" x2="20" y2="19"/>`,
		'check': `<polyline points="20 6 9 17 4 12"/>`,
		'github': `<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>`,
		'send': `<line x1="22" y1="2" x2="11" y2="13"/>
		<polygon points="22 2 15 22 11 13 2 9 22 2"/>`,
		'webhook': `<path d="M18 16.98h-5.99c-1.1 0-1.95.68-2.95 1.76"/>
		<path d="M18 21c-3 0-4-2-4-2V11c0-3-3-3-3-3"/>
		<path d="M6 21V11c0-3 3-3 3-3h9"/>
		<circle cx="6" cy="18" r="3"/>
		<circle cx="18" cy="5" r="3"/>
		<circle cx="6" cy="5" r="3"/>`,
	};
	
	const iconPath = $derived(icons[name] || icons['info']);
</script>

<svg 
	width={size} 
	height={size} 
	viewBox="0 0 24 24" 
	fill="none" 
	stroke="currentColor" 
	stroke-width="2" 
	stroke-linecap="round" 
	stroke-linejoin="round" 
	class="icon {class_}"
	aria-hidden="true"
>
	{@html iconPath}
</svg>

<style>
	.icon {
		display: inline-block;
		vertical-align: middle;
		flex-shrink: 0;
	}
</style>