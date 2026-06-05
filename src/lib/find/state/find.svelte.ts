import { cancelJob, docSearch, docReplace } from '$lib/ipc/doc';
import type { CodeViewApi } from '$lib/views/code/CodeView.svelte';
import type { DocHandle, Path, SearchHit } from '$lib/ipc/types';

const FIND_DEBOUNCE_MS = 160;

export interface FindDeps {
	
	handle: () => DocHandle | null;
	
	canOpen: () => boolean;
	
	isCodeView: () => boolean;
	
	isGraphView: () => boolean;
	
	switchToTree: () => void;
	
	codeApi: () => CodeViewApi | null;
	
	openGraphSearch: () => void;
	
	navigateToHit: (path: Path) => void | Promise<void>;
	
	afterReplace: (affectedPaths: Path[]) => Promise<void>;
}

export class FindController {
	open = $state(false);
	query = $state('');
	hits: SearchHit[] = $state([]);
	activeIdx = $state(0);
	busy = $state(false);
	error: string | null = $state(null);
	replaceValue = $state('');
	replaceStatus: string | null = $state(null);
	codeMatchCount = $state(0);
	codeActiveIdx = $state(0);

	private seq = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private hitsQuery: string | null = null;
	private activeJobId: string | null = null;

	constructor(private deps: FindDeps) {}

	
	counter = $derived.by(() => {
		if (this.error) return this.error;
		if (!this.query.trim()) return '';
		if (this.deps.isCodeView()) {
			return this.codeMatchCount === 0
				? 'no matches'
				: `${this.codeActiveIdx} / ${this.codeMatchCount}`;
		}
		if (this.busy) return 'searching…';
		return this.hits.length === 0 ? 'no matches' : `${this.activeIdx + 1} / ${this.hits.length}`;
	});

	navDisabled = $derived.by(() =>
		this.deps.isCodeView() ? this.codeMatchCount === 0 : this.hits.length === 0,
	);

	openFind = () => {
		if (!this.deps.canOpen()) return;
		if (this.deps.isCodeView()) {
			this.open = true;
			const api = this.deps.codeApi();
			if (api) {
				this.codeMatchCount = api.cmSearch(this.query.trim(), false);
				this.codeActiveIdx = this.codeMatchCount > 0 ? 1 : 0;
			}
			return;
		}
		if (this.deps.isGraphView()) {
			this.deps.openGraphSearch();
			return;
		}
		this.deps.switchToTree();
		this.open = true;
	};

	close = () => {
		if (this.activeJobId !== null || this.busy) this.cancel();
		this.open = false;
		this.error = null;
	};

	
	syncActiveView = () => {
		const q = this.query.trim();
		if (!this.open || !q) return;
		if (this.deps.isCodeView()) {
			const api = this.deps.codeApi();
			if (!api) return; // editor still mounting — re-fires when codeApi is ready
			this.codeMatchCount = api.cmSearch(q, false);
			this.codeActiveIdx = this.codeMatchCount > 0 ? 1 : 0;
			return;
		}
		if (this.hitsQuery === q) return; // cached tree hits already match
		void this.runSearch(q);
	};

	onQueryChange = (q: string) => {
		this.query = q;
		this.error = null;
		this.replaceStatus = null; // a new search invalidates the prior replace count
		if (this.deps.isCodeView()) {
			const api = this.deps.codeApi();
			this.codeMatchCount = api ? api.cmSearch(q.trim(), false) : 0;
			this.codeActiveIdx = this.codeMatchCount > 0 ? 1 : 0;
			return;
		}
		if (this.timer != null) clearTimeout(this.timer);
		if (!q.trim()) {
			this.hits = [];
			this.hitsQuery = '';
			this.activeIdx = 0;
			this.busy = false;
			return;
		}
		this.busy = true;
		this.timer = setTimeout(() => {
			void this.runSearch(q);
		}, FIND_DEBOUNCE_MS);
	};

	runSearch = async (q: string) => {
		const handle = this.deps.handle();
		if (!handle) {
			this.busy = false;
			return;
		}
		if (this.activeJobId !== null) {
			const id = this.activeJobId;
			this.activeJobId = null;
			void cancelJob(id).catch(() => {
				
			});
		}
		const seq = ++this.seq;
		const jobId = crypto.randomUUID();
		this.activeJobId = jobId;
		try {
			const hits = await docSearch(handle, { query: q, caseSensitive: false }, jobId);
			if (seq !== this.seq) return; // a newer query started — drop stale.
			this.hits = hits;
			this.hitsQuery = q.trim();
			this.activeIdx = 0;
			if (hits.length > 0) await this.jumpToHit(0);
		} catch (e) {
			if (seq !== this.seq) return;
			this.error = String(e);
			this.hits = [];
			this.hitsQuery = null;
		} finally {
			if (this.activeJobId === jobId) this.activeJobId = null;
			if (seq === this.seq) this.busy = false;
		}
	};

	
	cancel = () => {
		const id = this.activeJobId;
		this.activeJobId = null;
		this.seq++; // make any in-flight resolve a stale response
		this.busy = false;
		if (id) {
			void cancelJob(id).catch(() => {
				
			});
		}
	};

	jumpToHit = async (i: number) => {
		if (i < 0 || i >= this.hits.length) return;
		this.activeIdx = i;
		await this.deps.navigateToHit(this.hits[i].path);
	};

	next = () => {
		if (this.deps.isCodeView()) {
			const api = this.deps.codeApi();
			if (api && this.codeMatchCount > 0) {
				api.cmFindNext();
				this.codeActiveIdx = this.codeActiveIdx >= this.codeMatchCount ? 1 : this.codeActiveIdx + 1;
			}
			return;
		}
		if (this.hits.length === 0) return;
		void this.jumpToHit((this.activeIdx + 1) % this.hits.length);
	};

	prev = () => {
		if (this.deps.isCodeView()) {
			const api = this.deps.codeApi();
			if (api && this.codeMatchCount > 0) {
				api.cmFindPrev();
				this.codeActiveIdx = this.codeActiveIdx <= 1 ? this.codeMatchCount : this.codeActiveIdx - 1;
			}
			return;
		}
		if (this.hits.length === 0) return;
		void this.jumpToHit((this.activeIdx - 1 + this.hits.length) % this.hits.length);
	};

	replaceAll = async () => {
		const handle = this.deps.handle();
		if (!handle) return;
		const q = this.query.trim();
		if (!q) return;
		if (this.deps.isCodeView()) {
			const api = this.deps.codeApi();
			if (api) {
				const n = api.cmReplaceAll(q, this.replaceValue, false);
				this.replaceStatus = n === 0 ? 'no matches' : `replaced ${n}`;
				this.codeMatchCount = api.cmSearch(q, false);
				this.codeActiveIdx = this.codeMatchCount > 0 ? 1 : 0;
			}
			return;
		}
		this.replaceStatus = 'replacing…';
		try {
			const res = await docReplace(handle, q, this.replaceValue, false);
			if (res.applied) {
				await this.deps.afterReplace(res.applied.affectedPaths);
			}
			this.replaceStatus = res.count === 0 ? 'no matches' : `replaced ${res.count}`;
			if (this.open && q) void this.runSearch(q); // refresh the hit count
		} catch (e) {
			this.error = String(e).replace(/^.*?Error:\s*/i, '');
			this.replaceStatus = null;
		}
	};

	
	reset = () => {
		if (this.activeJobId !== null) this.cancel();
		this.open = false;
		this.query = '';
		this.hits = [];
		this.hitsQuery = null;
		this.activeIdx = 0;
		this.error = null;
		this.busy = false;
	};
}
