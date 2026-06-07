module.exports = {
	'*.{js,ts,svelte}': ['prettier --write', 'eslint --fix --no-warn-ignored'],
	'*.{css,json,html,yml,yaml}': 'prettier --write',
	'src-tauri/**/*.rs': () => 'cargo fmt --manifest-path src-tauri/Cargo.toml',
};
