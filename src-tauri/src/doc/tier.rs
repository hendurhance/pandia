use serde::{Deserialize, Serialize};

pub const LAZY_THRESHOLD_BYTES: u64 = 10 * 1024 * 1024;
pub const CODE_VIEW_MAX_BYTES: u64 = 50 * 1024 * 1024;
pub const EDIT_SIZE_LIMIT: u64 = 200 * 1024 * 1024;
pub const MAPPED_THRESHOLD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_DOC_BYTES: u64 = 10 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Tier {
    Small,
    Lazy,
    Large,
    Mapped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub edit: bool,
    pub export: bool,
    pub export_converted: bool,
    pub validate: bool,
    pub sort_filter: bool,
    pub code_view: bool,
    pub graph: bool,
    pub compare: bool,
    pub typegen: bool,
    pub typegen_schema: bool,
}

impl Tier {
    pub fn of(size: u64) -> Self {
        match size {
            s if s < LAZY_THRESHOLD_BYTES => Tier::Small,
            s if s <= EDIT_SIZE_LIMIT => Tier::Lazy,
            s if s <= MAPPED_THRESHOLD_BYTES => Tier::Large,
            _ => Tier::Mapped,
        }
    }

    pub fn admit(size: u64) -> Option<Self> {
        (size <= MAX_DOC_BYTES).then(|| Self::of(size))
    }

    pub fn whole_document(self) -> bool {
        matches!(self, Tier::Small | Tier::Lazy)
    }

    pub fn capabilities(self, size: u64) -> Capabilities {
        let whole = self.whole_document();
        let in_memory = self != Tier::Mapped;
        Capabilities {
            edit: whole,
            export: in_memory,
            export_converted: whole,
            validate: whole,
            sort_filter: in_memory,
            code_view: whole && size <= CODE_VIEW_MAX_BYTES,
            graph: in_memory,
            compare: whole,
            typegen: in_memory,
            typegen_schema: whole,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_size_falls_in_one_tier_and_over_the_ceiling_is_refused() {
        for (size, tier) in [
            (0, Tier::Small),
            (LAZY_THRESHOLD_BYTES - 1, Tier::Small),
            (LAZY_THRESHOLD_BYTES, Tier::Lazy),
            (EDIT_SIZE_LIMIT, Tier::Lazy),
            (EDIT_SIZE_LIMIT + 1, Tier::Large),
            (MAPPED_THRESHOLD_BYTES, Tier::Large),
            (MAPPED_THRESHOLD_BYTES + 1, Tier::Mapped),
            (MAX_DOC_BYTES, Tier::Mapped),
        ] {
            assert_eq!(Tier::admit(size), Some(tier), "{size} bytes");
        }
        assert_eq!(Tier::admit(MAX_DOC_BYTES + 1), None);
    }

    #[test]
    fn the_mapped_tier_reads_but_never_writes_sorts_or_converts() {
        let caps = Tier::Mapped.capabilities(MAX_DOC_BYTES);
        assert_eq!(
            caps,
            Capabilities {
                edit: false,
                export: false,
                export_converted: false,
                validate: false,
                sort_filter: false,
                code_view: false,
                graph: false,
                compare: false,
                typegen: false,
                typegen_schema: false,
            }
        );
        let large = Tier::Large.capabilities(EDIT_SIZE_LIMIT + 1);
        assert!(!large.edit && !large.validate && !large.compare && !large.code_view);
        assert!(large.export && large.sort_filter && large.graph && large.typegen);
        assert!(!large.export_converted && !large.typegen_schema);
        let lazy = Tier::Lazy.capabilities(EDIT_SIZE_LIMIT);
        assert!(lazy.export_converted && lazy.typegen_schema);
    }

    #[test]
    fn code_view_stops_at_its_own_limit_inside_the_lazy_tier() {
        assert!(Tier::Lazy.capabilities(CODE_VIEW_MAX_BYTES).code_view);
        assert!(!Tier::Lazy.capabilities(CODE_VIEW_MAX_BYTES + 1).code_view);
        assert!(Tier::Lazy.capabilities(EDIT_SIZE_LIMIT).edit);
    }
}
