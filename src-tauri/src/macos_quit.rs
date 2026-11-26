use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use objc2::ffi::class_addMethod;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{class, msg_send, sel};
use tauri::{AppHandle, Manager};

static APP: OnceLock<AppHandle> = OnceLock::new();
static AWAITING_REPLY: AtomicBool = AtomicBool::new(false);

const TERMINATE_NOW: usize = 1;
const TERMINATE_LATER: usize = 2;

type ShouldTerminate = extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize;

extern "C-unwind" fn should_terminate(_: *mut AnyObject, _: Sel, _: *mut AnyObject) -> usize {
    let Some(window) = APP.get().and_then(|app| app.get_webview_window("main")) else {
        return TERMINATE_NOW;
    };
    AWAITING_REPLY.store(true, Ordering::SeqCst);
    let _ = window.close();
    TERMINATE_LATER
}

pub(crate) fn finish_quit(allow: bool) {
    if !AWAITING_REPLY.swap(false, Ordering::SeqCst) {
        return;
    }
    unsafe {
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![ns_app, replyToApplicationShouldTerminate: Bool::new(allow)];
    }
}

pub(crate) fn ask_before_quit(app: &AppHandle) {
    let _ = APP.set(app.clone());
    unsafe {
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![ns_app, delegate];
        let Some(delegate) = delegate.as_ref() else {
            return;
        };
        let cls = delegate.class() as *const AnyClass as *mut AnyClass;
        let imp = std::mem::transmute::<ShouldTerminate, Imp>(should_terminate);
        class_addMethod(
            cls,
            sel!(applicationShouldTerminate:),
            imp,
            c"Q@:@".as_ptr(),
        );
    }
}
