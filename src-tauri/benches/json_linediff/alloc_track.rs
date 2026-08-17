use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};

pub struct TrackingAlloc;

static CURRENT: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

#[global_allocator]
static GLOBAL: TrackingAlloc = TrackingAlloc;

fn on_alloc(size: usize) {
    let cur = CURRENT.fetch_add(size, Relaxed) + size;
    PEAK.fetch_max(cur, Relaxed);
}

fn on_dealloc(size: usize) {
    CURRENT.fetch_sub(size, Relaxed);
}

unsafe impl GlobalAlloc for TrackingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let p = System.alloc(layout);
        if !p.is_null() {
            on_alloc(layout.size());
        }
        p
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
        on_dealloc(layout.size());
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let p = System.alloc_zeroed(layout);
        if !p.is_null() {
            on_alloc(layout.size());
        }
        p
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let p = System.realloc(ptr, layout, new_size);
        if !p.is_null() {
            on_dealloc(layout.size());
            on_alloc(new_size);
        }
        p
    }
}

pub fn reset_peak() {
    PEAK.store(CURRENT.load(Relaxed), Relaxed);
}

pub fn current() -> usize {
    CURRENT.load(Relaxed)
}

pub fn peak() -> usize {
    PEAK.load(Relaxed)
}
