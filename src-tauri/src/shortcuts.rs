use serde::Serialize;

#[derive(Clone, Copy, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Platform {
    All,
    Mac,
    NotMac,
}

#[derive(Serialize, specta::Type)]
pub struct Shortcut {
    pub command: &'static str,
    pub key: &'static str,
    pub shift: bool,
    pub alt: bool,
    pub platform: Platform,
}

const fn cmd(command: &'static str, key: &'static str) -> Shortcut {
    Shortcut {
        command,
        key,
        shift: false,
        alt: false,
        platform: Platform::All,
    }
}

impl Shortcut {
    const fn shift(self) -> Self {
        Shortcut {
            shift: true,
            ..self
        }
    }

    const fn alt(self) -> Self {
        Shortcut { alt: true, ..self }
    }

    const fn only(self, platform: Platform) -> Self {
        Shortcut { platform, ..self }
    }

    fn applies_here(&self) -> bool {
        match self.platform {
            Platform::All => true,
            Platform::Mac => cfg!(target_os = "macos"),
            Platform::NotMac => !cfg!(target_os = "macos"),
        }
    }
}

pub const SHORTCUTS: &[Shortcut] = &[
    cmd("tab.new", "T"),
    cmd("doc.new", "N"),
    cmd("doc.openFile", "O"),
    cmd("doc.save", "S"),
    cmd("doc.saveAs", "S").shift(),
    cmd("doc.export", "E"),
    cmd("tab.next", "]").shift(),
    cmd("tab.prev", "[").shift(),
    cmd("tab.close", "W"),
    cmd("doc.undo", "Z"),
    cmd("doc.redo", "Z").shift(),
    cmd("find.open", "F"),
    cmd("find.next", "G"),
    cmd("find.prev", "G").shift(),
    // macOS reserves Cmd+H for Hide; each platform gets its usual Find and Replace keys.
    cmd("find.replace", "F").alt().only(Platform::Mac),
    cmd("find.replace", "H").only(Platform::NotMac),
    cmd("palette.toggle", "K"),
    cmd("view.toggleSidebar", "B"),
    cmd("view.tree", "1"),
    cmd("view.code", "2"),
    cmd("view.grid", "3"),
    cmd("view.graph", "4"),
    cmd("nav.settings", ","),
    cmd("view.openSchemaPanel", "V").shift(),
    cmd("compare.pick", "D"),
    cmd("help.shortcuts", "/"),
];

pub fn accelerator(command: &str) -> Option<String> {
    let s = SHORTCUTS
        .iter()
        .find(|s| s.command == command && s.applies_here())?;
    let alt = if s.alt { "Alt+" } else { "" };
    let shift = if s.shift { "Shift+" } else { "" };
    Some(format!("CmdOrCtrl+{alt}{shift}{}", s.key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_and_replace_uses_each_platforms_standard_keys() {
        let expected = if cfg!(target_os = "macos") {
            "CmdOrCtrl+Alt+F"
        } else {
            "CmdOrCtrl+H"
        };
        assert_eq!(accelerator("find.replace").as_deref(), Some(expected));
        assert_eq!(
            accelerator("doc.saveAs").as_deref(),
            Some("CmdOrCtrl+Shift+S")
        );
        assert_eq!(accelerator("tree.expandAll"), None);
    }
}
